import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { BookOpen, Check, Copy, MagnifyingGlass } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";
import { WIKI_SECTIONS, type WikiEntry, type WikiSection } from "./crafterWikiData";

type ProtocolFilter = "all" | "sip" | "http" | "ssh" | "mcp";

export function CrafterWiki() {
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("all");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const { enabled: mcpEnabled } = useFeatureFlag(FEATURE_FLAG_MCP_UI);

  const availableProtocols = useMemo(
    () => (mcpEnabled ? (["all", "sip", "http", "ssh", "mcp"] as const) : (["all", "sip", "http", "ssh"] as const)),
    [mcpEnabled],
  );

  useEffect(() => {
    if (!mcpEnabled && protocolFilter === "mcp") {
      setProtocolFilter("all");
    }
  }, [mcpEnabled, protocolFilter]);

  const sections = useMemo(() => {
    const visibleSections = mcpEnabled
      ? WIKI_SECTIONS
      : WIKI_SECTIONS.filter((section) => section.protocol !== "mcp");

    return visibleSections.filter((section) => {
      if (protocolFilter !== "all" && section.protocol !== protocolFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        section.title.toLowerCase().includes(q) ||
        section.content.some(
          (entry) =>
            entry.text.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
        )
      );
    });
  }, [protocolFilter, search]);

  useEffect(() => {
    if (sections.length === 0) {
      setSelectedSectionId(null);
      return;
    }
    const stillExists = sections.some((section) => section.id === selectedSectionId);
    if (!stillExists) setSelectedSectionId(sections[0]!.id);
  }, [sections, selectedSectionId]);

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) ?? null,
    [sections, selectedSectionId],
  );

  const visibleEntries = useMemo(() => {
    if (!selectedSection) return [];
    if (!search.trim()) return selectedSection.content;
    const q = search.trim().toLowerCase();
    return selectedSection.content.filter(
      (entry) =>
        entry.heading ||
        entry.text.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q),
    );
  }, [search, selectedSection]);

  const sectionCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const section of sections) {
      if (!q) {
        counts.set(section.id, section.content.length);
        continue;
      }
      const count = section.content.filter(
        (entry) =>
          entry.heading ||
          entry.text.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q),
      ).length;
      counts.set(section.id, count);
    }
    return counts;
  }, [search, sections]);

  const groupedSections = useMemo(() => {
    const sip = sections.filter((section) => section.protocol === "sip");
    const http = sections.filter((section) => section.protocol === "http");
    const ssh = sections.filter((section) => section.protocol === "ssh");
    const mcp = sections.filter((section) => section.protocol === "mcp");
    return { sip, http, ssh, mcp };
  }, [sections]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 1400);
    } catch {
      // Ignore clipboard permission failures.
    }
  }, []);

  return (
    <div className="flex min-h-full flex-col gap-3 p-4">
      <div className="ui-panel-shell px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Composer Docs</p>
            <p className="text-xs text-muted-foreground/70">
              Unified reference for Composer protocols, request patterns, and SSH commands.
            </p>
          </div>
          <div className="relative w-80 max-w-[45%] min-w-56">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {availableProtocols.map((protocol) => (
            <button
              key={protocol}
              type="button"
              onClick={() => setProtocolFilter(protocol)}
              className={cn(
                "h-7 px-2.5 rounded-lg text-2xs transition-smooth",
                protocolFilter === protocol
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
              )}
            >
              {protocol === "all" ? "All" : protocol.toUpperCase()}
            </button>
          ))}
          <div className="ml-auto text-2xs text-muted-foreground/70">
            {sections.length} section{sections.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          variant="inline"
          compact
          icon={<BookOpen className="h-5 w-5" />}
          title="No docs found"
          description="Try a different search term or protocol filter."
        />
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3">
          <aside className="ui-panel-shell min-h-0 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-border/20">
              <p className="section-label-sm">Sections</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
              {groupedSections.sip.length > 0 ? (
                <SectionGroup
                  title="SIP"
                  sections={groupedSections.sip}
                  selectedSectionId={selectedSectionId}
                  counts={sectionCounts}
                  onSelect={setSelectedSectionId}
                />
              ) : null}
              {groupedSections.http.length > 0 ? (
                <SectionGroup
                  title="HTTP"
                  sections={groupedSections.http}
                  selectedSectionId={selectedSectionId}
                  counts={sectionCounts}
                  onSelect={setSelectedSectionId}
                />
              ) : null}
              {groupedSections.ssh.length > 0 ? (
                <SectionGroup
                  title="SSH"
                  sections={groupedSections.ssh}
                  selectedSectionId={selectedSectionId}
                  counts={sectionCounts}
                  onSelect={setSelectedSectionId}
                />
              ) : null}
              {groupedSections.mcp.length > 0 ? (
                <SectionGroup
                  title="MCP"
                  sections={groupedSections.mcp}
                  selectedSectionId={selectedSectionId}
                  counts={sectionCounts}
                  onSelect={setSelectedSectionId}
                />
              ) : null}
            </div>
          </aside>

          <section className="ui-panel-shell min-h-0 overflow-hidden flex flex-col">
            {selectedSection ? (
              <>
                <div className="px-4 py-3 border-b border-border/20">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-3xs border-border/30",
                        selectedSection.protocol === "sip"
                          ? "text-protocol-sip"
                          : selectedSection.protocol === "http"
                            ? "text-protocol-http"
                            : selectedSection.protocol === "ssh"
                              ? "text-warning"
                              : "text-primary",
                      )}
                    >
                      {selectedSection.protocol.toUpperCase()}
                    </Badge>
                    <p className="text-sm font-semibold text-foreground">{selectedSection.title}</p>
                    <span className="ml-auto text-2xs text-muted-foreground/70">
                      {visibleEntries.length} item{visibleEntries.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                  {visibleEntries.map((entry) => (
                    <EntryRow key={`${selectedSection.id}:${entry.text}`} entry={entry} copiedText={copiedText} onCopy={handleCopy} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                variant="inline"
                compact
                icon={<BookOpen className="h-5 w-5" />}
                title="Select a section"
                description="Pick a section from the left to view details."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SectionGroup({
  title,
  sections,
  selectedSectionId,
  counts,
  onSelect,
}: {
  title: string;
  sections: WikiSection[];
  selectedSectionId: string | null;
  counts: Map<string, number>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="section-label-sm px-1 text-muted-foreground/70">{title}</p>
      <div className="space-y-1">
        {sections.map((section) => {
          const active = section.id === selectedSectionId;
          const count = counts.get(section.id) ?? section.content.length;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={cn(
                "w-full text-left rounded-lg px-2.5 py-2 border transition-smooth",
                active
                  ? "border-border/40 bg-accent/40 text-foreground"
                  : "border-transparent hover:border-border/30 hover:bg-muted/20 text-muted-foreground",
              )}
            >
              <p className={cn("text-xs truncate", active ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
                {section.title}
              </p>
              <p className="text-3xs text-muted-foreground/70 mt-0.5">{count} entries</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  copiedText,
  onCopy,
}: {
  entry: WikiEntry;
  copiedText: string | null;
  onCopy: (text: string) => Promise<void>;
}) {
  if (entry.heading) {
    return (
      <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
        <p className="section-label-sm">{entry.text}</p>
        <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">{entry.description}</p>
      </div>
    );
  }

  const isCopied = copiedText === entry.text;
  const hasTemplate = Boolean(entry.sipTemplate || entry.httpTemplate);

  return (
    <div className="rounded-lg border border-border/20 bg-background/20 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold text-foreground">{entry.text}</p>
            {hasTemplate ? (
              <Badge variant="outline" className="text-3xs border-border/30 text-muted-foreground">
                Template
              </Badge>
            ) : null}
          </div>
          <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">{entry.description}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          disabled={!entry.insertable}
          onClick={() => entry.insertable && void onCopy(entry.text)}
          aria-label={`Copy ${entry.text}`}
        >
          {isCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      {hasTemplate ? (
        <pre className="mt-2 rounded-lg border border-border/20 bg-muted/20 px-2 py-1.5 text-2xs font-mono text-muted-foreground/70 overflow-x-auto">
          {JSON.stringify(entry.sipTemplate ?? entry.httpTemplate, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
