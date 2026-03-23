/**
 * SearchButton — header search with two variants:
 *
 * "icon"  → compact button that opens GlobalSearchDialog.
 * "field" → real text input with an inline command-palette dropdown.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Fuse from "fuse.js";
import { Button } from "@/components/ui/button";
import { Search } from "@/lib/icons";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useNoteStore } from "@/stores/noteStore";
import { searchNotes } from "@/api/notes";
import { navigateTo } from "@/lib/navigation";
import { shortcutLabel } from "@/lib/shortcuts";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
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
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Server, Satellite, StickyNote, FileText, Clock, Loader2 } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface SearchButtonProps {
  /** "icon" = compact button (default), "field" = inline search bar. */
  variant?: "icon" | "field";
}

export type HeaderInlineSearchProps = {
  /** Wrapper around the anchor (width constraints, flex). */
  anchorClassName?: string;
  /** Focus target for global ⌘K shortcut. */
  inputId?: string;
  /** Dropdown alignment under the field. */
  popoverAlign?: "start" | "center" | "end";
  /** Sit inside HeaderUnifiedOmniBar — no nested chrome border. */
  embedded?: boolean;
};

/** Command palette field for the unified header omni bar (or standalone). */
export function HeaderInlineCommandSearch(props: HeaderInlineSearchProps) {
  return <InlineSearchField {...props} />;
}

/** Self-contained search button / bar for the header. */
export function SearchButton({ variant = "icon" }: SearchButtonProps) {
  const setSearchOpen = useLayoutStore((s) => s.setSearchOpen);

  if (variant === "field") {
    return <InlineSearchField />;
  }

  return (
    <TooltipWrapper entry={tooltips.headerSearch}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setSearchOpen(true)}
        className="h-8 w-8"
      >
        <Search className="h-4 w-4" />
      </Button>
    </TooltipWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  InlineSearchField — real input + dropdown command palette
// ═══════════════════════════════════════════════════════════════════════════

function InlineSearchField(props: HeaderInlineSearchProps = {}) {
  const {
    anchorClassName,
    inputId = "header-omni-search-input",
    popoverAlign = "start",
    embedded = false,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const registrars = useRegistrationStore((s) => s.registrars);
  const setSelectedRegistrar = useRegistrationStore((s) => s.setSelectedRegistrar);
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const agentConnections = useRemoteAgentStore((s) => s.connections);
  const selectAgent = useRemoteAgentStore((s) => s.selectAgent);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [noteItems, setNoteItems] = useState<PaletteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  // ── Static commands (module-level cache, zero cost) ────────────────
  const commands = getStaticCommands();
  const cmdFuse = getStaticFuse();
  const defaultNav = getDefaultNav();
  const defaultAct = getDefaultAct();

  // ── Registrar items ────────────────────────────────────────────────
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

  // ── Capture items ──────────────────────────────────────────────────
  const capItems = useMemo<PaletteItem[]>(
    () =>
      sessions.map((s) => ({
        id: `cap:${s.id}`,
        category: "capture" as const,
        name: s.name || s.id,
        subtitle: s.status + (s.interface ? ` · ${s.interface}` : ""),
        keywords: [s.name || "", s.description || "", s.interface || "", s.id],
        icon: FileText,
        run: () => navigateTo("packet-capture", "viewer", { packetCaptureSessionId: s.id }),
      })),
    [sessions],
  );

  // ── Agent items ────────────────────────────────────────────────────
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

  // ── Deferred Fuse indexes (only built when searching) ──────────────
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

  // ── Fuzzy search results ───────────────────────────────────────────
  const allMatched = useMemo(
    () => (searching ? cmdFuse.search(trimmed).map((r) => r.item) : []),
    [cmdFuse, trimmed, searching],
  );
  const matchedNav = useMemo(
    () => allMatched.filter((c) => c.category === "navigation").slice(0, MAX_PER_GROUP),
    [allMatched],
  );
  const matchedAct = useMemo(
    () => allMatched.filter((c) => c.category === "action").slice(0, MAX_PER_GROUP),
    [allMatched],
  );
  const matchedRegs = useMemo(
    () => (searching ? getRegFuse().search(trimmed).slice(0, MAX_PER_GROUP).map((r) => r.item) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regItems, trimmed, searching],
  );
  const matchedCaps = useMemo(
    () => (searching ? getCapFuse().search(trimmed).slice(0, MAX_PER_GROUP).map((r) => r.item) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capItems, trimmed, searching],
  );
  const matchedAgents = useMemo(
    () => (searching ? getAgentFuse().search(trimmed).slice(0, MAX_PER_GROUP).map((r) => r.item) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentItems, trimmed, searching],
  );

  // ── Recents ────────────────────────────────────────────────────────
  const recentItems = useMemo(() => {
    if (!recentIds.length) return [];
    const all = [...commands, ...regItems, ...capItems, ...agentItems];
    const byId = new Map(all.map((i) => [i.id, i]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((x): x is PaletteItem => x != null)
      .slice(0, MAX_RECENT);
  }, [recentIds, commands, regItems, capItems, agentItems]);

  // ── Notes search (debounced async) ─────────────────────────────────
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

  // ── Open / close lifecycle ─────────────────────────────────────────
  const handleOpen = useCallback(() => {
    if (open) return;
    setOpen(true);
    setRecentIds(loadRecentIds());
  }, [open]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setNoteItems([]);
    setNotesLoading(false);
    inputRef.current?.blur();
  }, []);

  // Close when focus leaves both input and dropdown
  const handleBlur = useCallback(
    (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // If focus moved to something inside our container or the popover content, stay open
      if (related && (containerRef.current?.contains(related) || related.closest("[data-slot='popover-content']"))) {
        return;
      }
      handleClose();
    },
    [handleClose],
  );

  // ── Select item ────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (item: PaletteItem) => {
      saveRecentId(item.id);
      item.run();
      handleClose();
    },
    [handleClose],
  );

  // ── Keyboard: Escape to close ──────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    },
    [handleClose],
  );

  // ── Derived ────────────────────────────────────────────────────────
  const totalResults =
    matchedNav.length + matchedAct.length + matchedRegs.length + matchedCaps.length + matchedAgents.length + noteItems.length;
  const noResults = searching && totalResults === 0 && !notesLoading;

  // ═════════ Render ═════════
  return (
    <Popover open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <PopoverAnchor asChild>
        <div
          ref={containerRef}
          className={cn("relative w-full min-w-[140px]", !embedded && "max-w-[320px]", anchorClassName)}
          onBlur={handleBlur}
        >
          {/* ── Input field ── */}
          <div
            className={cn(
              "inline-flex w-full items-center gap-1.5 rounded-md border text-xs font-medium",
              "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              "h-7 shadow-none",
              embedded
                ? "border-0 bg-transparent px-0.5 ring-0 shadow-none"
                : "ui-header-picker max-w-[320px]",
              !embedded && open && "is-open",
              embedded && open && "rounded-sm bg-muted/15",
            )}
          >
            <Search className={cn("h-3.5 w-3.5 flex-shrink-0", embedded && "text-muted-foreground/70")} />
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={handleOpen}
              onKeyDown={handleKeyDown}
              placeholder="Search or jump…"
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70 text-xs min-w-0"
              data-no-window-drag="true"
            />
            <kbd className="hidden sm:inline text-2xs font-mono text-muted-foreground/65 flex-shrink-0">
              ⌘K
            </kbd>
          </div>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align={popoverAlign}
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className={cn(
          "min-w-[320px] max-w-[480px] w-[min(480px,80vw)] p-0 overflow-hidden",
          "ui-panel-shell rounded-[var(--radius-md)]",
        )}
      >
        <Command shouldFilter={false} onKeyDown={handleKeyDown}>
            <div className="ui-floating-header-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search or jump…"
                  className="h-8 w-full rounded-md bg-transparent pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>
            <CommandList className="max-h-[min(50vh,380px)] scroll-py-1 overflow-x-hidden overflow-y-auto">
              {/* No results */}
              {noResults && (
                <div className="flex flex-col items-center gap-1.5 py-8 select-none">
                  <span className="text-sm text-muted-foreground">
                    No results for &ldquo;{trimmed}&rdquo;
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    Try a different search term
                  </span>
                </div>
              )}

              {/* Notes loading */}
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
                        <DropdownRow
                          key={item.id}
                          item={item}
                          onSelect={handleSelect}
                          trailing={<Clock className="size-3 text-muted-foreground/60" />}
                        />
                      ))}
                    </CommandGroup>
                  )}

                  <CommandGroup heading="Navigation">
                    {defaultNav.map((item) => (
                      <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </CommandGroup>

                  <CommandGroup heading="Actions">
                    {defaultAct.map((item) => (
                      <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </CommandGroup>

                  {regItems.length > 0 && (
                    <CommandGroup heading="Registrars">
                      {regItems.slice(0, MAX_PER_GROUP).map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}

                  {agentItems.length > 0 && (
                    <CommandGroup heading="Agents">
                      {agentItems.slice(0, MAX_PER_GROUP).map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
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
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                  {matchedAct.length > 0 && (
                    <CommandGroup heading="Actions">
                      {matchedAct.map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                  {matchedRegs.length > 0 && (
                    <CommandGroup heading="Registrars">
                      {matchedRegs.map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                  {matchedCaps.length > 0 && (
                    <CommandGroup heading="Captures">
                      {matchedCaps.map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                  {matchedAgents.length > 0 && (
                    <CommandGroup heading="Agents">
                      {matchedAgents.map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                  {noteItems.length > 0 && (
                    <CommandGroup heading="Notes">
                      {noteItems.map((item) => (
                        <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-border/30 px-3 py-2 text-2xs text-muted-foreground/60 select-none">
              <span className="flex items-center gap-0.5">
                <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-0.5">
                <Kbd>↵</Kbd> select
              </span>
              <span className="flex items-center gap-0.5">
                <Kbd>esc</Kbd> close
              </span>
              {searching && (
                <span className="ml-auto">
                  {totalResults} result{totalResults !== 1 ? "s" : ""}
                </span>
              )}
            </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-2xs leading-tight min-w-[16px]">
      {children}
    </kbd>
  );
}

interface DropdownRowProps {
  item: PaletteItem;
  onSelect: (item: PaletteItem) => void;
  trailing?: ReactNode;
}

function DropdownRow({ item, onSelect, trailing }: DropdownRowProps) {
  const Icon = item.icon;
  return (
    <CommandItem value={item.id} onSelect={() => onSelect(item)} className="gap-2.5 py-1.5">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/20">
        <Icon className="size-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{item.name}</div>
        {item.subtitle && (
          <div className="text-2xs text-muted-foreground truncate">{item.subtitle}</div>
        )}
      </div>
      {trailing}
      {item.shortcut && (
        <CommandShortcut className="flex items-center gap-0.5 text-2xs">
          {shortcutLabel(item.shortcut)}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
