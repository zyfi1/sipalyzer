/**
 * GlobalSearchDialog — full command palette (modal). Opens from the header
 * control or ⌘K / Ctrl+K (layoutStore.searchOpen).
 *
 * Performance notes:
 * - Static commands + Fuse index are cached at module level (instant open)
 * - Dynamic Fuse indexes (registrars, captures) are only built when the user
 *   actually types a search query, and cached via useRef
 * - No backend fetches on open; uses whatever data is already in stores
 * - Notes search is debounced and async
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Fuse from "fuse.js";
import { searchNotes } from "@/api/notes";
import { useRegistrationStore } from "@/stores/registrationStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useNoteStore } from "@/stores/noteStore";
import { shortcutLabel } from "@/lib/shortcuts";
import { navigateTo } from "@/lib/navigation";
import {
  type PaletteItem,
  FUSE_OPTS,
  MAX_PER_GROUP,
  MAX_RECENT,
  NOTES_DEBOUNCE_MS,
  NOTES_MIN_CHARS,
  loadRecentIds,
  saveRecentId,
  getStaticCommands,
  getStaticFuse,
  getDefaultNav,
  getDefaultAct,
} from "@/lib/paletteItems";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Server,
  Satellite,
  StickyNote,
  FileText,
  Clock,
  Loader2,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function GlobalSearchDialog() {
  const isOpen = useLayoutStore((s) => s.searchOpen);
  const setSearchOpen = useLayoutStore((s) => s.setSearchOpen);
  const registrars = useRegistrationStore((s) => s.registrars);
  const setSelectedRegistrar = useRegistrationStore(
    (s) => s.setSelectedRegistrar,
  );
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const agentConnections = useRemoteAgentStore((s) => s.connections);
  const selectAgent = useRemoteAgentStore((s) => s.selectAgent);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);

  /* ── Local state ── */
  const [query, setQuery] = useState("");
  const [noteItems, setNoteItems] = useState<PaletteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  /* ── Static commands (module-level cache, zero cost) ── */
  const commands = getStaticCommands();
  const cmdFuse = getStaticFuse();
  const defaultNav = getDefaultNav();
  const defaultAct = getDefaultAct();

  /* ── Registrar palette items ── */
  const regItems = useMemo<PaletteItem[]>(
    () =>
      registrars.map((r) => ({
        id: `reg:${r.id ?? r.name}`,
        category: "registrar" as const,
        name: r.name,
        subtitle: r.domain,
        keywords: [r.name, r.domain],
        icon: Server,
        run: () => {
          setSelectedRegistrar(r.id ?? "");
          navigateTo("registration");
        },
      })),
    [registrars, setSelectedRegistrar],
  );

  /* ── Capture palette items ── */
  const capItems = useMemo<PaletteItem[]>(
    () =>
      sessions.map((s) => ({
        id: `cap:${s.id}`,
        category: "capture" as const,
        name: s.name || s.id,
        subtitle: s.status + (s.interface ? ` \u00B7 ${s.interface}` : ""),
        keywords: [
          s.name || "",
          s.description || "",
          s.interface || "",
          s.id,
        ],
        icon: FileText,
        run: () =>
          navigateTo("packet-capture", "viewer", {
            packetCaptureSessionId: s.id,
          }),
      })),
    [sessions],
  );

  /* ── Agent palette items ── */
  const agentItems = useMemo<PaletteItem[]>(
    () =>
      agentConnections
        .filter((a) => a.status === "connected")
        .map((a) => ({
          id: `agent:${a.id}`,
          category: "agent" as const,
          name: a.name || a.hostname,
          subtitle: `${a.ip} · ${a.os}`,
          keywords: [a.name || "", a.hostname, a.ip, a.os, "agent", "remote"],
          icon: Satellite,
          run: () => {
            selectAgent(a.id);
            navigateTo("remote-agent", "registry");
          },
        })),
    [agentConnections, selectAgent],
  );

  /* ── Deferred Fuse indexes for dynamic items (only built when searching) ── */
  const regFuseRef = useRef<{ key: unknown; fuse: Fuse<PaletteItem> } | null>(null);
  const capFuseRef = useRef<{ key: unknown; fuse: Fuse<PaletteItem> } | null>(null);
  const agentFuseRef = useRef<{ key: unknown; fuse: Fuse<PaletteItem> } | null>(null);

  function getRegFuse(): Fuse<PaletteItem> {
    if (!regFuseRef.current || regFuseRef.current.key !== regItems) {
      regFuseRef.current = { key: regItems, fuse: new Fuse(regItems, FUSE_OPTS) };
    }
    return regFuseRef.current.fuse;
  }

  function getCapFuse(): Fuse<PaletteItem> {
    if (!capFuseRef.current || capFuseRef.current.key !== capItems) {
      capFuseRef.current = { key: capItems, fuse: new Fuse(capItems, FUSE_OPTS) };
    }
    return capFuseRef.current.fuse;
  }

  function getAgentFuse(): Fuse<PaletteItem> {
    if (!agentFuseRef.current || agentFuseRef.current.key !== agentItems) {
      agentFuseRef.current = { key: agentItems, fuse: new Fuse(agentItems, FUSE_OPTS) };
    }
    return agentFuseRef.current.fuse;
  }

  /* ── Fuzzy search results (search mode only) ── */
  const allMatched = useMemo(
    () => (searching ? cmdFuse.search(trimmed).map((r) => r.item) : []),
    [cmdFuse, trimmed, searching],
  );

  const matchedNav = useMemo(
    () =>
      allMatched
        .filter((c) => c.category === "navigation")
        .slice(0, MAX_PER_GROUP),
    [allMatched],
  );

  const matchedAct = useMemo(
    () =>
      allMatched
        .filter((c) => c.category === "action")
        .slice(0, MAX_PER_GROUP),
    [allMatched],
  );

  const matchedRegs = useMemo(
    () =>
      searching
        ? getRegFuse()
            .search(trimmed)
            .slice(0, MAX_PER_GROUP)
            .map((r) => r.item)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regItems, trimmed, searching],
  );

  const matchedCaps = useMemo(
    () =>
      searching
        ? getCapFuse()
            .search(trimmed)
            .slice(0, MAX_PER_GROUP)
            .map((r) => r.item)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capItems, trimmed, searching],
  );

  const matchedAgents = useMemo(
    () =>
      searching
        ? getAgentFuse()
            .search(trimmed)
            .slice(0, MAX_PER_GROUP)
            .map((r) => r.item)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentItems, trimmed, searching],
  );

  /* ── Recent items (resolved from persisted ids) ── */
  const recentItems = useMemo(() => {
    if (!recentIds.length) return [];
    const all = [...commands, ...regItems, ...capItems, ...agentItems];
    const byId = new Map(all.map((i) => [i.id, i]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((x): x is PaletteItem => x != null)
      .slice(0, MAX_RECENT);
  }, [recentIds, commands, regItems, capItems, agentItems]);

  /* ── Notes search (debounced async) ── */
  useEffect(() => {
    if (trimmed.length < NOTES_MIN_CHARS) {
      setNoteItems([]);
      setNotesLoading(false);
      return;
    }
    setNotesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const notes = await searchNotes(trimmed);
        setNoteItems(
          notes.slice(0, MAX_PER_GROUP).map((n) => ({
            id: `note:${n.id}`,
            category: "note" as const,
            name: n.title || "Untitled",
            subtitle: n.tags?.length ? n.tags.join(", ") : undefined,
            icon: StickyNote,
            run: () => {
              setSelectedNoteId(n.id);
              setNotesCenterOpen(true);
            },
          })),
        );
      } catch {
        setNoteItems([]);
      } finally {
        setNotesLoading(false);
      }
    }, NOTES_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, setSelectedNoteId, setNotesCenterOpen]);

  /* ── Reset on open (lightweight — no backend calls) ── */
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setNoteItems([]);
    setNotesLoading(false);
    setRecentIds(loadRecentIds());
  }, [isOpen]);

  /* ── Handlers ── */
  const close = useCallback(() => setSearchOpen(false), [setSearchOpen]);

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      saveRecentId(item.id);
      item.run();
      close();
    },
    [close],
  );

  /* ── Derived state ── */
  const totalResults =
    matchedNav.length +
    matchedAct.length +
    matchedRegs.length +
    matchedCaps.length +
    matchedAgents.length +
    noteItems.length;

  const noResults = searching && totalResults === 0 && !notesLoading;

  /* ═════════ Render ═════════ */
  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && close()}>
      <DialogContent
        className="sm:max-w-2xl overflow-hidden p-0 gap-0 rounded-xl border-border/50 shadow-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>
            Search commands, tools, registrars, captures, and notes
          </DialogDescription>
        </DialogHeader>

        <Command
          shouldFilter={false}
          className={cn(
            "[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
            "[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider",
            "[&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0",
            "[&_[cmdk-input]]:h-12",
          )}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search tools, registrars, captures, notes…"
          />

          <CommandList className="max-h-[min(60vh,420px)] scroll-py-1 overflow-x-hidden overflow-y-auto">
            {/* No results */}
            {noResults && (
              <div className="flex flex-col items-center gap-1.5 py-12 select-none">
                <span className="text-sm text-muted-foreground">
                  No results for &ldquo;{trimmed}&rdquo;
                </span>
                <span className="text-xs text-muted-foreground/60">
                  Try a different search term
                </span>
              </div>
            )}

            {/* Notes loading indicator */}
            {notesLoading && searching && (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground select-none">
                <Loader2 className="size-3 animate-spin" />
                Searching notes&hellip;
              </div>
            )}

            {/* ═════ Default view (empty query) ═════ */}
            {!searching && (
              <>
                {recentItems.length > 0 && (
                  <CommandGroup heading="Recent">
                    {recentItems.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                        trailing={
                          <Clock className="size-3 text-muted-foreground/60" />
                        }
                      />
                    ))}
                  </CommandGroup>
                )}

                <CommandGroup heading="Navigation">
                  {defaultNav.map((item) => (
                    <PaletteRow
                      key={item.id}
                      item={item}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>

                <CommandGroup heading="Actions">
                  {defaultAct.map((item) => (
                    <PaletteRow
                      key={item.id}
                      item={item}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>

                {regItems.length > 0 && (
                  <CommandGroup heading="Registrars">
                    {regItems.slice(0, MAX_PER_GROUP).map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {agentItems.length > 0 && (
                  <CommandGroup heading="Agents">
                    {agentItems.slice(0, MAX_PER_GROUP).map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}

            {/* ═════ Search results ═════ */}
            {searching && !noResults && (
              <>
                {matchedNav.length > 0 && (
                  <CommandGroup heading="Navigation">
                    {matchedNav.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {matchedAct.length > 0 && (
                  <CommandGroup heading="Actions">
                    {matchedAct.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {matchedRegs.length > 0 && (
                  <CommandGroup heading="Registrars">
                    {matchedRegs.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {matchedCaps.length > 0 && (
                  <CommandGroup heading="Captures">
                    {matchedCaps.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {matchedAgents.length > 0 && (
                  <CommandGroup heading="Agents">
                    {matchedAgents.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

                {noteItems.length > 0 && (
                  <CommandGroup heading="Notes">
                    {noteItems.map((item) => (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>

          {/* Footer with keyboard hints */}
          <div className="flex items-center gap-3 border-t border-border/30 px-3 py-2 text-2xs text-muted-foreground/70 select-none">
            <span className="flex items-center gap-1">
              <Kbd>{"\u2191"}</Kbd>
              <Kbd>{"\u2193"}</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>{"\u21B5"}</Kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd>
              close
            </span>
            <span className="ml-auto">
              {searching
                ? `${totalResults} result${totalResults !== 1 ? "s" : ""}`
                : "Command palette"}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-2xs leading-tight min-w-[18px]">
      {children}
    </kbd>
  );
}

interface PaletteRowProps {
  item: PaletteItem;
  onSelect: (item: PaletteItem) => void;
  trailing?: React.ReactNode;
}

function PaletteRow({ item, onSelect, trailing }: PaletteRowProps) {
  const Icon = item.icon;
  return (
    <CommandItem
      value={item.id}
      onSelect={() => onSelect(item)}
      className="gap-3"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/20">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{item.name}</div>
        {item.subtitle && (
          <div className="text-2xs text-muted-foreground truncate mt-0.5">
            {item.subtitle}
          </div>
        )}
      </div>
      {trailing}
      {item.shortcut && (
        <CommandShortcut className="flex items-center gap-0.5">
          {shortcutLabel(item.shortcut)}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
