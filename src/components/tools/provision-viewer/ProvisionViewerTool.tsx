import { useState, useMemo, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { fetchUrl } from "@/api/provision";
import { useToolStore } from "@/stores/toolStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { dispatchFetchProvision } from "@/lib/executionDispatch";
import { FileSearch, Loader2, ChevronRight, ChevronDown, Copy, Check, Link2, Search, Smartphone, Users, Info, Trash2, CheckCircle2, FileText, Phone, List, Code, Layers, Plus } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, AnimatedTabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { DeviceView } from "./DeviceView";
import { DeviceModelPicker, MODEL_VENDOR } from "./DeviceModelPicker";
import { ProvisionRegistrarWizard } from "./ProvisionRegistrarWizard";
import { ProvisionDiffView } from "./ProvisionDiffView";
import { ProvisionDesigner } from "./ProvisionDesigner";
import { FirmwareCatalogView } from "@/components/tools/firmware-catalog/FirmwareCatalogView";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { getFieldInfoWithFallback } from "./yealinkFieldReference";
import { cn } from "@/lib/utils";
import { PanelResizeHandle } from "@/components/ui/panel-chrome";
import { parseContactsFile, getBestPhone, parsedContactToImport } from "@/lib/provisionContactUtils";
import { useContactsStore } from "@/stores/contactsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import { getProvisionViewerNavItems, isProvisionViewerSubviewAvailable, type ProvisionSubviewId } from "@/lib/provisionNav";

/**
 * Smart parsing for option strings. Returns array of individual options.
 * Handles different formats:
 * - Pipe-separated: "A | B | C"
 * - Numbered options: "0 = X, 1 = Y" (splits before digit=)
 * - Semicolon-separated: "value1; value2"
 * - Free text (returns as single item)
 */
function parseOptionsString(options: string): string[] {
  if (!options || !options.trim()) return [];
  
  const trimmed = options.trim();
  
  // 1. Pipe-separated values (e.g. "PCMU | PCMA | G729")
  if (trimmed.includes(" | ")) {
    return trimmed.split(" | ").map(s => s.trim()).filter(Boolean);
  }
  
  // 2. Numbered options pattern: "0 = X, 1 = Y, 2 = Z"
  // Split on ", " followed by a digit and "=" but preserve the digit
  const numberedPattern = /,\s+(?=\d+\s*=)/;
  if (numberedPattern.test(trimmed)) {
    return trimmed.split(numberedPattern).map(s => s.trim()).filter(Boolean);
  }
  
  // 3. Semicolon-separated (e.g. "Any string; empty = default")
  // Only split if semicolons separate distinct value descriptions
  if (trimmed.includes(";")) {
    const parts = trimmed.split(/;\s*/).map(s => s.trim()).filter(Boolean);
    // If we got meaningful parts, use them
    if (parts.length > 1) {
      return parts;
    }
  }
  
  // 4. Check for simple comma-separated enumeration without descriptions
  // e.g. "value1, value2, value3" (no "=" signs mixed in)
  const hasEquals = trimmed.includes("=");
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (!hasEquals && commaCount > 0 && commaCount <= 10) {
    // Simple list without descriptions
    return trimmed.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  }
  
  // 5. Default: return as single item (free text)
  return [trimmed];
}

/** Detect MAC address in URL (12 hex chars, with or without : - .). Returns normalized lowercase 12-char hex or null. */
function detectMacFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  // 12 hex in a row (e.g. 00156574b150 or in 00156574b150.cfg)
  const plain = /[0-9a-fA-F]{12}/.exec(trimmed);
  if (plain) return plain[0].toLowerCase();
  // With separators: 00:15:65:74:b1:50 or 00-15-65-74-b1-50
  const withSep = /(?:[0-9a-fA-F]{2}[:\-.]?){5}[0-9a-fA-F]{2}/.exec(trimmed);
  if (withSep) {
    const normalized = withSep[0].replace(/[:\-.]/g, "").toLowerCase();
    return normalized.length === 12 ? normalized : null;
  }
  return null;
}


/**
 * Resolve contact/phonebook file URL from provision entries.
 *
 * Yealink:
 *   1) Explicit: mac-contact.file, mac_contact.file, phone_setting.remote_phonebook*.url
 *   2) Derived: .cfg → -contact.xml
 *
 * Poly:
 *   1) Explicit: dir.corp.address, feature.corporateDirectory.uri, mb.main.home
 *   2) Derived: .cfg → -directory.xml
 */
function getContactFileUrl(
  entries: { key: string; value: string }[] | undefined,
  finalProvisionUrl: string | undefined,
  vendor?: string
): string | null {
  if (entries?.length) {
    if (vendor === "poly") {
      // Poly contact/directory keys
      for (const e of entries) {
        const k = e.key.trim().toLowerCase();
        const v = e.value?.trim();
        if (!v) continue;
        if (k === "dir.corp.address" || k === "feature.corporatedirectory.uri"
            || k === "dir.local.contacts.uri" || k === "mb.main.home") return v;
        if ((k.startsWith("dir.") && k.includes("address")) || (k.includes("directory") && k.includes("uri")))
          return v;
      }
    } else {
      // Yealink contact keys
      const yealinkKeys = [
        "mac-contact.file", "mac_contact.file",
        "phone_setting.remote_phonebook.1.url",
        "phone_setting.remote_phonebook_url",
        "phone_setting.remote_phonebook.url",
      ];
      for (const e of entries) {
        const k = e.key.trim().toLowerCase();
        const v = e.value?.trim();
        if (!v) continue;
        if (yealinkKeys.some((x) => k === x.toLowerCase())) return v;
        if ((k.includes("phonebook") && k.includes("url")) || (k.includes("remote_phonebook") && k.includes("url")))
          return v;
      }
    }
  }
  if (finalProvisionUrl?.trim()) {
    const url = finalProvisionUrl.trim();
    if (vendor === "poly") {
      if (/\.cfg(?=\?|$)/i.test(url)) return url.replace(/\.cfg(?=\?|$)/i, "-directory.xml");
    } else {
      if (/\.cfg(?=\?|$)/i.test(url)) return url.replace(/\.cfg(?=\?|$)/i, "-contact.xml");
    }
  }
  return null;
}


/** Device tab: 1:1 visual mockup of selected Yealink model; screen content from provision. */
function DeviceTabContent({
  model,
  mac,
  parsedEntries,
}: {
  model: string;
  mac: string;
  parsedEntries: { key: string; value: string }[] | null;
}) {
  const [inCall, setInCall] = useState(false);
  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 w-full">
      {/* Call toggle — phone-themed button */}
      <div className="flex items-center justify-center">
        <TooltipWrapper
          title={inCall ? "End Call" : "Simulate Call"}
          description={inCall ? "End the simulated call and return to idle." : "Start a simulated call to see in-call screen and softkeys."}
        >
          <button
            type="button"
            onClick={() => setInCall(prev => !prev)}
            className={cn(
            "group relative flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
            inCall
              ? "bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25 hover:border-destructive/50"
              : "bg-success/15 text-success border border-success/30 hover:bg-success/25 hover:border-success/50"
          )}
        >
          <span className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
            inCall
              ? "bg-destructive text-destructive-foreground shadow-[0_0_12px_rgba(239,68,68,0.4)]"
              : "bg-success text-success-foreground shadow-[0_0_12px_rgba(16,185,129,0.4)]"
          )}>
            <Phone className={cn("h-3.5 w-3.5 transition-transform duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]", inCall && "rotate-[135deg]")} />
          </span>
          <span className="min-w-[5rem] text-left">
            {inCall ? "End Call" : "Simulate Call"}
          </span>
          {inCall && (
            <span className="flex gap-0.5 ml-1">
              <span className="w-1 h-1 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
              <span className="w-1 h-1 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none [animation-delay:var(--motion-duration-navigation)]" />
              <span className="w-1 h-1 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none [animation-delay:calc(var(--motion-duration-navigation)*2)]" />
            </span>
          )}
        </button>
        </TooltipWrapper>
      </div>
      <DeviceView
        modelId={model}
        mac={mac}
        parsedEntries={parsedEntries}
        inCall={inCall}
        onEndCall={() => setInCall(false)}
      />
    </div>
  );
}

export function ProvisionViewerTool() {
  type TableColumnKey = "key" | "value" | "info";
  const TABLE_COLUMN_WIDTHS_SESSION_KEY = "provisionViewer.tableColumnWidths";
  const MIN_TABLE_COLUMN_WIDTH: Record<TableColumnKey, number> = {
    key: 220,
    value: 220,
    info: 260,
  };
  const MAX_TABLE_COLUMN_WIDTH_FALLBACK = 1200;
  const { provisionViewerData, activeSubviewId } = useToolStore((s) => ({
    provisionViewerData: s.provisionViewerData,
    activeSubviewId: s.activeSubviewId,
  }));
  const result = provisionViewerData.result;
  const providerUrl = provisionViewerData.providerUrl;
  const mac = provisionViewerData.mac;
  const model = provisionViewerData.model;
  const includeMacInUa = provisionViewerData.includeMacInUa ?? (MODEL_VENDOR[provisionViewerData.model] === "poly" ? false : true);
  const contactsFileContent = provisionViewerData.contactsFileContent ?? null;
  const contactsFileLoading = provisionViewerData.contactsFileLoading ?? false;
  const contactsFileError = provisionViewerData.contactsFileError ?? null;

  /** Contact file URL: from provision key (mac-contact.file) or derived from final URL (.../MAC.cfg → .../MAC-contact.xml). */
  const activeVendor = MODEL_VENDOR[model] ?? "yealink";

  const macContactFileUrl = useMemo(
    () => getContactFileUrl(result?.parsed?.entries, result?.request_info?.final_url, activeVendor),
    [result?.parsed?.entries, result?.request_info?.final_url, activeVendor]
  );

  /** Parsed contacts from contact file content (Yealink XML, Poly XML, or CSV). */
  const parsedContacts = useMemo(
    () => (contactsFileContent ? parseContactsFile(contactsFileContent) : []),
    [contactsFileContent]
  );

  /** Tab: default to "provision" on mount, but allow switching to device/contacts/diff.
   *  An explicit activeSubviewId (e.g. from sidebar click) overrides. */
  type ViewId = ProvisionSubviewId;
  const hasProvisionLoaded = Boolean(result);
  const [view, setViewLocal] = useState<ViewId>("provision");
  const headerItems = useMemo(() => getProvisionViewerNavItems(hasProvisionLoaded), [hasProvisionLoaded]);
  const allowedViewIds = useMemo(() => headerItems.map((item) => item.id), [headerItems]);
  const setView = (v: ViewId) => {
    const next: ViewId = isProvisionViewerSubviewAvailable(v, hasProvisionLoaded) ? v : "provision";
    setViewLocal(next);
    useToolStore.getState().setLastViewedSubview("provision-viewer", next);
  };

  const [macFromUrl, setMacFromUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedContactNumberKey, setCopiedContactNumberKey] = useState<string | null>(null);
  const [configView, setConfigView] = useState<"groups" | "table" | "raw">("groups");
  const [contactsSearch, setContactsSearch] = useState("");
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<TableColumnKey, number>>({
    key: 360,
    value: 360,
    info: 300,
  });
  const textMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tableResizeStateRef = useRef<{
    column: TableColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [registrarWizardOpen, setRegistrarWizardOpen] = useState(false);
  const [includeExtensions, setIncludeExtensions] = useState(false);
  const [addedContactIds, setAddedContactIds] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);
  const softphoneContacts = useContactsStore((s) => s.contacts);
  const addContact = useContactsStore((s) => s.addContact);
  const importContacts = useContactsStore((s) => s.importContacts);
  const activeToolId = useToolStore((s) => s.activeToolId);
  useEffect(() => {
    setHeaderPortal(document.getElementById("header-tool-widget-custom"));
  }, []);

  useEffect(() => {
    if (activeToolId !== "provision-viewer") return;
    const resolved = activeSubviewId === "fetch" ? "provision" : activeSubviewId;
    if (isProvisionViewerSubviewAvailable(resolved, true)) {
      const next: ViewId = isProvisionViewerSubviewAvailable(resolved, hasProvisionLoaded) ? resolved : "provision";
      setViewLocal(next);
      const store = useToolStore.getState();
      store.setLastViewedSubview("provision-viewer", next);
      store.setActiveSubview(null);
    }
  }, [activeToolId, activeSubviewId, hasProvisionLoaded]);

  useEffect(() => {
    if (!allowedViewIds.includes(view)) {
      setViewLocal("provision");
      useToolStore.getState().setLastViewedSubview("provision-viewer", "provision");
    }
  }, [allowedViewIds, view]);

  const handleUrlChange = (value: string) => {
    useToolStore.getState().setProvisionViewerForm({ providerUrl: value });
    const detected = detectMacFromUrl(value);
    if (detected) {
      useToolStore.getState().setProvisionViewerForm({ mac: detected });
      setMacFromUrl(true);
    }
  };

  const handleMacChange = (value: string) => {
    useToolStore.getState().setProvisionViewerForm({ mac: value });
    setMacFromUrl(false);
  };

  const handleModelChange = (value: string) => {
    useToolStore.getState().setProvisionViewerForm({ model: value });
  };

  const ctx = useExecutionContextStore((s) => s.resolvedContext)("provisionFetch");
  const getEffectiveUserAgentForScope = useSettingsStore((s) => s.getEffectiveUserAgentForScope);

  const handleFetch = async () => {
    setError(null);
    useToolStore.getState().setProvisionViewerContactsFile(null, false, null);
    setLoading(true);
    let macToUse = mac.trim();
    if (!macToUse) {
      const fromUrl = detectMacFromUrl(providerUrl);
      if (fromUrl) {
        useToolStore.getState().setProvisionViewerForm({ mac: fromUrl });
        setMacFromUrl(true);
        macToUse = fromUrl;
      }
    }
    try {
      const vendor = MODEL_VENDOR[model] ?? "yealink";
      const provisionUserAgent = await getEffectiveUserAgentForScope("provisionFetch");
      const res = await dispatchFetchProvision(ctx, providerUrl, macToUse, model, {
        includeMacInUa,
        vendor,
        userAgent: provisionUserAgent,
      });
      const data = res.result;
      useToolStore.getState().setProvisionViewerResult(data);
      if (data.parsed?.groups) {
        setExpandedGroups(new Set(Object.keys(data.parsed.groups)));
      }
      const contactsUrl = getContactFileUrl(data.parsed?.entries, data.request_info?.final_url, vendor);
      if (contactsUrl) {
        useToolStore.getState().setProvisionViewerContactsFile(null, true, null);
        const userAgent = data.request_info?.user_agent ?? provisionUserAgent ?? undefined;
        try {
          const content = await fetchUrl(contactsUrl, userAgent);
          useToolStore.getState().setProvisionViewerContactsFile(content, false);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          useToolStore.getState().setProvisionViewerContactsFile(null, false, errMsg);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (prefix: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const filteredEntries = useMemo(() => {
    if (!result?.parsed?.entries) return [];
    const q = searchFilter.trim().toLowerCase();
    if (!q) return result.parsed.entries;
    return result.parsed.entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
    );
  }, [result?.parsed?.entries, searchFilter]);

  const filteredParsedContacts = useMemo(() => {
    const q = contactsSearch.trim().toLowerCase();
    const rows = parsedContacts.map((contact, index) => ({ contact, index }));
    if (!q) return rows;
    return rows.filter(({ contact }) => {
      const haystack = [
        contact.displayName,
        contact.office,
        contact.mobile,
        contact.other,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [parsedContacts, contactsSearch]);

  const importableContactsCount = useMemo(() => {
    return parsedContacts.reduce((acc, c) => acc + (parsedContactToImport(c, includeExtensions) ? 1 : 0), 0);
  }, [parsedContacts, includeExtensions]);

  const formatPhoneDisplay = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return raw;
  };

  const copyContactNumber = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedContactNumberKey(key);
      setTimeout(() => {
        setCopiedContactNumberKey((prev) => (prev === key ? null : prev));
      }, 1400);
    } catch {
      // Ignore clipboard errors (browser/security context).
    }
  };

  const getContactNumbers = (contact: { office?: string; mobile?: string; other?: string }) => {
    const rawItems = [
      { label: "Office", value: contact.office ?? "" },
      { label: "Mobile", value: contact.mobile ?? "" },
      { label: "Other", value: contact.other ?? "" },
    ].filter((item) => item.value.trim().length > 0);

    const seen = new Set<string>();
    return rawItems.filter((item) => {
      const dedupeKey = item.value.trim().replace(/\s+/g, " ").toLowerCase();
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  };

  const copyRaw = async () => {
    if (!result?.raw) return;
    try {
      await navigator.clipboard.writeText(result.raw);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch (_) {}
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(TABLE_COLUMN_WIDTHS_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<TableColumnKey, number>>;
      const next: Record<TableColumnKey, number> = {
        key: Math.max(MIN_TABLE_COLUMN_WIDTH.key, Number(parsed.key ?? 360)),
        value: Math.max(MIN_TABLE_COLUMN_WIDTH.value, Number(parsed.value ?? 360)),
        info: Math.max(MIN_TABLE_COLUMN_WIDTH.info, Number(parsed.info ?? 300)),
      };
      setTableColumnWidths(next);
    } catch {
      // Ignore malformed session state and keep defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(TABLE_COLUMN_WIDTHS_SESSION_KEY, JSON.stringify(tableColumnWidths));
    } catch {
      // Ignore storage failures (private mode/quota).
    }
  }, [tableColumnWidths]);

  const measureTextWidth = (text: string, font: string): number => {
    if (typeof window === "undefined") return text.length * 8;
    if (!textMeasureCanvasRef.current) {
      textMeasureCanvasRef.current = window.document.createElement("canvas");
    }
    const ctx = textMeasureCanvasRef.current.getContext("2d");
    if (!ctx) return text.length * 8;
    ctx.font = font;
    return Math.ceil(ctx.measureText(text).width);
  };

  const autoFitTableColumn = (column: TableColumnKey) => {
    const entries = filteredEntries.length > 0
      ? filteredEntries
      : (result?.parsed?.entries ?? []);
    const sample = entries.slice(0, 1200);
    const maxAllowed = typeof window !== "undefined"
      ? Math.max(MIN_TABLE_COLUMN_WIDTH[column], Math.floor(window.innerWidth * 0.72))
      : MAX_TABLE_COLUMN_WIDTH_FALLBACK;
    let maxContentWidth = 0;

    if (column === "key") {
      maxContentWidth = measureTextWidth("Key", "600 12px Inter, sans-serif");
      for (const e of sample) {
        maxContentWidth = Math.max(
          maxContentWidth,
          measureTextWidth(e.key ?? "", "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace")
        );
      }
    } else if (column === "value") {
      maxContentWidth = measureTextWidth("Value", "600 12px Inter, sans-serif");
      for (const e of sample) {
        maxContentWidth = Math.max(
          maxContentWidth,
          measureTextWidth(e.value ?? "", "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace")
        );
      }
    } else {
      maxContentWidth = measureTextWidth("Info", "600 12px Inter, sans-serif");
      for (const e of sample) {
        const fieldInfo = getFieldInfoWithFallback(e.key);
        maxContentWidth = Math.max(
          maxContentWidth,
          measureTextWidth(fieldInfo.label ?? "", "600 11px Inter, sans-serif"),
          measureTextWidth(fieldInfo.description ?? "", "10px Inter, sans-serif")
        );
      }
    }

    const padded = maxContentWidth + 36;
    const nextWidth = Math.min(maxAllowed, Math.max(MIN_TABLE_COLUMN_WIDTH[column], padded));
    setTableColumnWidths((prev) => ({ ...prev, [column]: nextWidth }));
  };

  const startTableColumnResize = (column: TableColumnKey, e: ReactMouseEvent<HTMLElement>) => {
    if (e.detail > 1) return;
    e.preventDefault();
    e.stopPropagation();
    tableResizeStateRef.current = {
      column,
      startX: e.clientX,
      startWidth: tableColumnWidths[column],
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      const state = tableResizeStateRef.current;
      if (!state) return;
      const delta = moveEvent.clientX - state.startX;
      const nextWidth = Math.max(MIN_TABLE_COLUMN_WIDTH[state.column], state.startWidth + delta);
      setTableColumnWidths((prev) => ({ ...prev, [state.column]: nextWidth }));
    };

    const onMouseUp = () => {
      tableResizeStateRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs value={view} onValueChange={(v) => setView(v as ViewId)} className="flex-1 flex flex-col gap-0 min-h-0">
        <ToolHeader
          toolId="provision-viewer"
          items={headerItems}
          value={view}
          onValueChange={(v) => setView(v as ViewId)}
        />
        {activeToolId === "provision-viewer" && view === "provision" && headerPortal && createPortal(
          <div className="flex items-center ml-0">
            <ExecutionContextSelector
              toolId="provisionFetch"
              className="w-[150px] max-w-[150px]"
            />
          </div>,
          headerPortal,
        )}

        <div className="flex-1 flex flex-col min-h-0 app-view-gutter gap-3">
        <AnimatedTabsContent className="flex-1 min-h-0">
          <TabsContent value="contacts" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-auto space-y-4">
              {/* Error when contact file fetch failed (e.g. HTTP 500) — show prominently */}
              {macContactFileUrl && contactsFileError && (
                <div className="rounded-lg bg-destructive/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                      <Users className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-destructive">Failed to load contacts file</p>
                      <p className="text-sm text-destructive/80 mt-1">{contactsFileError}</p>
                      <p className="text-xs text-muted-foreground mt-2 font-mono break-all">{macContactFileUrl}</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        The server may require the same User-Agent as the provision request.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state when no contacts URL available */}
              {!macContactFileUrl && !result && (
                <EmptyState
                  variant="inline"
                  icon={<Users />}
                  title="No provision loaded"
                  description="Load a provision file first to check for contacts."
                  className="h-full p-8"
                  action={
                    <TooltipWrapper title="Load Provision" description="Switch to Provision tab to load a config file.">
                      <Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setView("provision")}>
                        <FileSearch className="h-3.5 w-3.5" />
                        Load Provision
                      </Button>
                    </TooltipWrapper>
                  }
                />
              )}
              {!macContactFileUrl && result && (
                <EmptyState
                  variant="inline"
                  icon={<Users />}
                  title="No contacts file referenced"
                  description="This provision doesn't include a remote phonebook URL. Contacts are typically configured separately."
                  className="h-full p-8"
                  action={
                    <Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setView("provision")}>
                      <FileSearch className="h-3.5 w-3.5" />
                      View Provision
                    </Button>
                  }
                />
              )}

              {/* Contacts view — contact-first layout (when file loaded) */}
              {macContactFileUrl && contactsFileContent != null && (
                <div className="space-y-4">
                  <div className="ui-surface-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0">
                          <Users className="h-4.5 w-4.5 text-foreground" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">Device Contacts</h3>
                          <p className="text-xs text-muted-foreground">
                            {parsedContacts.length > 0 ? `${parsedContacts.length} contact${parsedContacts.length !== 1 ? "s" : ""} parsed` : "Unparseable format"}
                          </p>
                        </div>
                      </div>
                      {parsedContacts.length > 0 && (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                          <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/60 tabular-nums">
                            {importableContactsCount} importable
                          </span>
                          <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/60 tabular-nums">
                            {softphoneContacts.length} in softphone
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {parsedContacts.length > 0 ? (
                    <div className="ui-surface-card overflow-hidden">
                      <div className="ui-section-header-md space-y-3">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={contactsSearch}
                            onChange={(e) => setContactsSearch(e.target.value)}
                            placeholder="Search contacts or numbers..."
                            className="h-8 text-xs pl-8 ui-control-shell"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 justify-between">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="include-ext" className="section-label-sm cursor-pointer whitespace-nowrap">
                              Include extensions
                            </Label>
                            <Switch
                              id="include-ext"
                              checked={includeExtensions}
                              onCheckedChange={setIncludeExtensions}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {filteredParsedContacts.length} / {parsedContacts.length}
                            </span>
                            <Button
                              variant="neutral"
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              onClick={() => {
                                const toImport = parsedContacts
                                  .map((c) => parsedContactToImport(c, includeExtensions))
                                  .filter((c): c is NonNullable<typeof c> => c !== null);
                                if (toImport.length === 0) {
                                  setImportResult({ imported: 0, skipped: 0 });
                                  return;
                                }
                                const imported = importContacts(toImport);
                                setImportResult({ imported, skipped: toImport.length - imported });
                                setTimeout(() => setImportResult(null), 5000);
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Import All
                            </Button>
                          </div>
                        </div>
                        {importResult && (
                          <div className={cn(
                            "text-xs font-medium px-2.5 py-2 rounded-lg border",
                            importResult.imported > 0
                              ? "bg-success/10 border-success/30 text-success"
                              : "bg-muted/40 border-border text-muted-foreground"
                          )}>
                            {importResult.imported > 0
                              ? `${importResult.imported} imported${importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ""}`
                              : "All eligible contacts already exist"}
                          </div>
                        )}
                      </div>

                      <div className="max-h-[560px] overflow-auto divide-y divide-border/30">
                        {filteredParsedContacts.map(({ contact: c, index: i }) => {
                          const bestPhone = getBestPhone(c, includeExtensions);
                          const isImportable = bestPhone !== null;
                          const alreadyInSoftphone = bestPhone
                            ? softphoneContacts.some((sc) => sc.phone.replace(/\D/g, "") === bestPhone.replace(/\D/g, ""))
                            : false;
                          const justAdded = addedContactIds.has(i);
                          const numberItems = getContactNumbers(c);
                          const secondary = numberItems.filter((item) => item.value !== bestPhone);

                          return (
                            <div key={i} className="px-4 py-3 hover:bg-muted/15 transition-smooth">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground truncate">{c.displayName}</p>
                                  {bestPhone ? (
                                    <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                                      <span className="text-xs text-muted-foreground shrink-0">Primary</span>
                                      <span className="font-mono text-sm text-foreground truncate">{formatPhoneDisplay(bestPhone)}</span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                                        onClick={() => copyContactNumber(bestPhone, `primary-${i}-${bestPhone}`)}
                                      >
                                        {copiedContactNumberKey === `primary-${i}-${bestPhone}` ? (
                                          <Check className="h-3.5 w-3.5 text-success" />
                                        ) : (
                                          <Copy className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    </div>
                                  ) : null}
                                  {secondary.length > 0 && (
                                    <div className="mt-1.5 text-xs text-muted-foreground">
                                      {secondary.map((item, idx) => (
                                        <span key={`${i}-${item.label}-${item.value}`}>
                                          <span className="font-medium">{item.label}:</span> <span className="font-mono">{formatPhoneDisplay(item.value)}</span>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-5 px-1 ml-0.5 align-middle text-muted-foreground hover:text-foreground"
                                            onClick={() => copyContactNumber(item.value, `item-${i}-${item.label}-${item.value}`)}
                                          >
                                            {copiedContactNumberKey === `item-${i}-${item.label}-${item.value}` ? (
                                              <Check className="h-3 w-3 text-success" />
                                            ) : (
                                              <Copy className="h-3 w-3" />
                                            )}
                                          </Button>
                                          {idx < secondary.length - 1 ? <span className="mx-1.5">·</span> : null}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div className="shrink-0">
                                  {justAdded ? (
                                    <div className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-success/10 border border-success/30 text-success text-xs">
                                      <Check className="h-3.5 w-3.5" />
                                      Added
                                    </div>
                                  ) : alreadyInSoftphone ? (
                                    <div className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-muted/40 border border-border text-muted-foreground text-xs">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      In contacts
                                    </div>
                                  ) : isImportable ? (
                                    <Button
                                      variant="neutral"
                                      size="sm"
                                      className="h-7 gap-1.5 text-xs px-2.5"
                                      onClick={() => {
                                        const data = parsedContactToImport(c, includeExtensions);
                                        if (!data) return;
                                        addContact(data);
                                        setAddedContactIds((prev) => new Set(prev).add(i));
                                        setTimeout(() => {
                                          setAddedContactIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(i);
                                            return next;
                                          });
                                        }, 2000);
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Add
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {filteredParsedContacts.length === 0 && (
                          <div className="p-6">
                            <EmptyState
                              compact
                              variant="inline"
                              icon={<Search />}
                              title={`No contacts match "${contactsSearch.trim()}"`}
                              description="Try a broader name or number search."
                              className="p-4"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="ui-surface-card p-4">
                      <p className="text-sm text-muted-foreground">
                        Could not parse contacts from file (unsupported format). See raw content below.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Source details and raw content (secondary) */}
              {macContactFileUrl && (
                <div className="space-y-4">
                  {/* Source URL */}
                  <div className="ui-surface-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source URL</span>
                    </div>
                    <p className="font-mono text-xs text-foreground/80 break-all">{macContactFileUrl}</p>
                  </div>

                  {contactsFileLoading && contactsFileContent == null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading contacts file…</span>
                    </div>
                  )}

                  {contactsFileContent != null && (
                    <div className="ui-surface-card overflow-hidden">
                      <div className="ui-section-header-md flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Raw Content</span>
                      </div>
                      <Textarea
                        readOnly
                        value={contactsFileContent}
                        className="min-h-[180px] font-mono text-xs resize-y border-0 rounded-none focus-visible:ring-0 bg-transparent"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="device" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-auto">
            {!result ? (
              <EmptyState
                variant="inline"
                icon={<Smartphone />}
                title="No device preview loaded"
                description="Load a provision config to render a live device mockup with your current model and settings."
                className="h-full p-10"
                action={
                  <TooltipWrapper title="Go to Provision" description="Switch to Provision tab to load a config first.">
                    <Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setView("provision")}>
                      <FileSearch className="h-3.5 w-3.5" />
                      Go to Provision
                    </Button>
                  </TooltipWrapper>
                }
              />
            ) : (
              <DeviceTabContent
                model={model}
                mac={result?.request_info?.mac_used ?? mac}
                parsedEntries={result?.parsed?.entries ?? null}
              />
            )}
            </div>
          </TabsContent>

          <TabsContent value="provision" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-auto space-y-4">
              {/* ── Input Form ── */}
              <div className="ui-surface-card overflow-hidden">
                <div className="px-5 py-5 space-y-4">
                  {/* Row 1: URL + Load button */}
                  <div className="flex gap-2">
                    <Input
                      id="provision-url"
                      placeholder="https://provider.example.com/yealink/{mac}.cfg"
                      value={providerUrl}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      className="font-mono text-sm h-9 flex-1"
                    />
                    <Button
                      onClick={handleFetch}
                      disabled={loading || !providerUrl.trim() || (!mac.trim() && !detectMacFromUrl(providerUrl))}
                      size="sm"
                      className="gap-2 h-9 px-4 text-sm shrink-0"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
                      Load Config
                    </Button>
                    {result && (
                      <TooltipWrapper title="Clear" description="Clear the loaded provision config.">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            useToolStore.getState().setProvisionViewerClear();
                            setError(null);
                            setSearchFilter("");
                            setExpandedGroups(new Set());
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipWrapper>
                    )}
                  </div>
                  {/* Row 2: MAC + Model + MAC-in-UA toggle */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Label htmlFor="provision-mac" className="section-label-sm shrink-0">MAC</Label>
                      <Input
                        id="provision-mac"
                        placeholder="00:15:65:74:B1:50"
                        value={mac}
                        onChange={(e) => handleMacChange(e.target.value)}
                        className={cn(
                          "font-mono text-sm h-8 flex-1 min-w-[140px]",
                          macFromUrl && "ring-1 ring-foreground/20 border-foreground/20"
                        )}
                      />
                      {macFromUrl && (
                        <span className="text-3xs font-medium px-1.5 py-0.5 rounded bg-accent text-foreground border border-border shrink-0">
                          auto
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Label htmlFor="provision-model" className="section-label-sm shrink-0">Model</Label>
                      <DeviceModelPicker value={model} onChange={handleModelChange} id="provision-model" />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Label htmlFor="provision-mac-in-ua" className="section-label-sm cursor-pointer whitespace-nowrap">MAC in UA</Label>
                      <Switch
                        id="provision-mac-in-ua"
                        checked={includeMacInUa}
                        onCheckedChange={(checked) => useToolStore.getState().setProvisionViewerForm({ includeMacInUa: checked })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {result && (
                <>
                  {/* Request details */}
                  <div className="ui-surface-card overflow-hidden">
                    <div className="px-4 py-3 space-y-3">
                      {/* URL row with status badge */}
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={cn(
                          "text-xs font-bold px-2.5 py-1 rounded-lg border shrink-0 tabular-nums mt-0.5",
                          result.request_info.status >= 400 && "bg-destructive/10 border-destructive/30 text-destructive",
                          result.request_info.status >= 200 && result.request_info.status < 300 && "bg-success/10 border-success/30 text-success",
                          result.request_info.status >= 300 && result.request_info.status < 400 && "bg-warning/10 border-warning/30 text-warning"
                        )}>
                          {result.request_info.status}
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="section-label-sm">Final URL</p>
                          <p className="font-mono text-sm text-foreground break-all leading-snug">{result.request_info.final_url}</p>
                        </div>
                      </div>

                      {/* Metadata grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg surface-subtle px-3 py-2">
                          <p className="section-label-sm mb-1">User-Agent</p>
                          <p className="font-mono text-xs text-foreground/90 break-all leading-snug">{result.request_info.user_agent}</p>
                        </div>
                        <div className="rounded-lg surface-subtle px-3 py-2">
                          <p className="section-label-sm mb-1">MAC Address</p>
                          <p className="font-mono text-sm text-foreground font-medium">{result.request_info.mac_used}</p>
                        </div>
                      </div>

                      {/* Redirects (if any) */}
                      {result.request_info.redirects?.length ? (
                        <div className="rounded-lg bg-warning/5 px-3 py-2">
                          <p className="section-label-sm text-warning mb-1">
                            {result.request_info.redirects.length} Redirect{result.request_info.redirects.length > 1 ? "s" : ""}
                          </p>
                          <div className="space-y-0.5">
                            {result.request_info.redirects.map((r, i) => (
                              <div key={i} className="flex items-center gap-1.5 font-mono text-xs text-foreground/70">
                                <ChevronRight className="h-3 w-3 text-warning/60 shrink-0" />
                                <span className="break-all">{r}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Retry log (if any) */}
                      {result.request_info.retry_log?.length ? (
                        <div className="rounded-lg surface-subtle px-3 py-2">
                          <p className="section-label-sm mb-1">Retry Log</p>
                          <div className="space-y-0.5">
                            {result.request_info.retry_log.map((line, i) => (
                              <p key={i} className="text-xs text-foreground/70">{line}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* ── Import as Registrar action ── */}
                  {result.parsed?.entries?.length ? (
                    <button
                      type="button"
                      onClick={() => setRegistrarWizardOpen(true)}
                      className="group surface-flat flex items-center gap-3 w-full px-4 py-3 transition-smooth hover:border-border hover:bg-muted/40"
                    >
                      <div className="shrink-0 w-8 h-8 rounded-full bg-accent group-hover:bg-muted/40 flex items-center justify-center transition-smooth">
                        <Plus className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-foreground">Import as Registrar</p>
                        <p className="text-xs text-muted-foreground">Create registrar entries from the SIP accounts found in this provision file</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-smooth" />
                    </button>
                  ) : null}


                  {/* ── Unified config explorer ── */}
                  <div className="ui-surface-card overflow-hidden flex flex-col">
                    {/* Toolbar: view toggles + search + copy */}
                    <div className="ui-section-header-sm flex items-center gap-2">
                      {/* View mode toggles */}
                      <div className="subview-tabs-compact shrink-0">
                        {([
                          { id: "groups" as const, icon: Layers, label: "Groups", count: result.parsed ? Object.keys(result.parsed.groups).length : 0 },
                          { id: "table" as const, icon: List, label: "Table", count: result.parsed?.entries.length ?? 0 },
                          { id: "raw" as const, icon: Code, label: "Raw", count: 0 },
                        ] as const).map(({ id, icon: Icon, label, count }) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setConfigView(id)}
                            data-state={configView === id ? "active" : "inactive"}
                            className="subview-tab-compact"
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span>{label}</span>
                            {count > 0 && (
                              <span className="tabular-nums text-2xs opacity-60">{count}</span>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Search (groups + table modes) */}
                      {configView !== "raw" && result.parsed && (
                        <div className="relative flex-1 min-w-0">
                          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Filter keys or values..."
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                            className="h-8 text-xs pl-8 ui-control-shell"
                          />
                        </div>
                      )}

                      {/* Spacer when in raw mode */}
                      {configView === "raw" && <div className="flex-1" />}

                      {/* Copy (raw mode) */}
                      {configView === "raw" && (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs px-2.5 shrink-0" onClick={copyRaw}>
                          {copiedRaw ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedRaw ? "Copied" : "Copy"}
                        </Button>
                      )}
                    </div>

                    {/* ── GROUPS view ── */}
                    {configView === "groups" && result.parsed && Object.keys(result.parsed.groups).length > 0 && (
                      <div className="divide-y divide-border/30 overflow-auto flex-1" style={{ maxHeight: "calc(100vh - 280px)" }}>
                        {Object.entries(result.parsed.groups)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .filter(([prefix, groupEntries]) => {
                            if (!searchFilter.trim()) return true;
                            const q = searchFilter.trim().toLowerCase();
                            return prefix.toLowerCase().includes(q) || groupEntries.some(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q));
                          })
                          .map(([prefix, groupEntries]) => {
                            const isExpanded = expandedGroups.has(prefix);
                            const q = searchFilter.trim().toLowerCase();
                            const visibleEntries = q
                              ? groupEntries.filter(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q) || prefix.toLowerCase().includes(q))
                              : groupEntries;
                            return (
                              <div key={prefix}>
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm font-medium hover:bg-muted/30 transition-smooth"
                                  onClick={() => toggleGroup(prefix)}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="text-foreground">{prefix}</span>
                                  <span className="text-muted-foreground/60 text-xs font-normal tabular-nums">
                                    {visibleEntries.length}
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div className="surface-subtle px-4 py-2.5 border-t border-border/50 font-mono text-xs space-y-1.5">
                                    {visibleEntries.map((e, i) => {
                                      const fieldInfo = getFieldInfoWithFallback(e.key);
                                      const known = !!fieldInfo.source;
                                      return (
                                        <div
                                          key={i}
                                          className={cn(
                                            "flex flex-wrap items-center gap-x-2 gap-y-0.5",
                                            known && "text-foreground"
                                          )}
                                        >
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span
                                                className={cn(
                                                  "shrink-0 cursor-help",
                                                  known
                                                    ? "text-muted-foreground underline decoration-dotted decoration-muted-foreground/60"
                                                    : "text-muted-foreground/80"
                                                )}
                                              >
                                                {e.key}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-sm max-h-[min(50vh,320px)] overflow-y-auto p-3 text-left space-y-2">
                                              {!known && (
                                                <p className="text-xs font-semibold text-warning dark:text-warning">Unknown parameter</p>
                                              )}
                                              <p className="font-mono text-xs text-foreground font-medium break-all">{e.key}</p>
                                              <p className="text-muted-foreground text-xs leading-snug">{fieldInfo.description}</p>
                                              {fieldInfo.options && (
                                                <div className="text-muted-foreground text-xs">
                                                  <span className="text-foreground font-medium">Possible values:</span>
                                                  <ul className="mt-0.5 ml-2 space-y-0.5">
                                                    {parseOptionsString(fieldInfo.options).map((opt, idx) => (
                                                      <li key={idx} className="font-mono">{opt}</li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                            </TooltipContent>
                                          </Tooltip>
                                          <span className="text-foreground break-all">
                                            = {e.value}
                                          </span>
                                          {known && (
                                            <span className="text-xs text-muted-foreground">
                                              [{fieldInfo.label}]
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}

                    {/* Groups empty / not parseable */}
                    {configView === "groups" && (!result.parsed || Object.keys(result.parsed.groups).length === 0) && (
                      <EmptyState
                        variant="inline"
                        icon={<Layers />}
                        title="No configuration groups"
                        description="This provision file does not contain parseable configuration groups."
                        className="h-full p-10"
                      />
                    )}

                    {/* ── TABLE view ── */}
                    {configView === "table" && (
                      <div className="flex-1 flex flex-col min-h-0">
                        {result.parsed?.entries.length ? (
                          <div className="flex-1 overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                            <table className="w-full min-w-max text-xs">
                              <colgroup>
                                <col style={{ width: `${tableColumnWidths.key}px` }} />
                                <col style={{ width: `${tableColumnWidths.value}px` }} />
                                <col style={{ width: `${tableColumnWidths.info}px` }} />
                              </colgroup>
                              <thead className="ui-sticky-header">
                                <tr className="border-b border-border">
                                  <th className="relative text-left py-2 px-3 section-label-sm border-r border-border/60">
                                    Key
                                    <PanelResizeHandle
                                      orientation="vertical"
                                      density="compact"
                                      appearance="table-edge"
                                      label="Resize Key column"
                                      title="Drag to resize. Double-click to auto-fit."
                                      className="absolute top-0 right-0 h-full w-2 rounded-none touch-none"
                                      onMouseDown={(e) => startTableColumnResize("key", e)}
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        autoFitTableColumn("key");
                                      }}
                                    />
                                  </th>
                                  <th className="relative text-left py-2 px-3 section-label-sm border-r border-border/60">
                                    Value
                                    <PanelResizeHandle
                                      orientation="vertical"
                                      density="compact"
                                      appearance="table-edge"
                                      label="Resize Value column"
                                      title="Drag to resize. Double-click to auto-fit."
                                      className="absolute top-0 right-0 h-full w-2 rounded-none touch-none"
                                      onMouseDown={(e) => startTableColumnResize("value", e)}
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        autoFitTableColumn("value");
                                      }}
                                    />
                                  </th>
                                  <th className="relative text-left py-2 px-3 section-label-sm">
                                    Info
                                    <PanelResizeHandle
                                      orientation="vertical"
                                      density="compact"
                                      appearance="table-edge"
                                      label="Resize Info column"
                                      title="Drag to resize. Double-click to auto-fit."
                                      className="absolute top-0 right-0 h-full w-2 rounded-none touch-none"
                                      onMouseDown={(e) => startTableColumnResize("info", e)}
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        autoFitTableColumn("info");
                                      }}
                                    />
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {filteredEntries.map((e, i) => {
                                  const fieldInfo = getFieldInfoWithFallback(e.key);
                                  const known = !!fieldInfo.source;
                                  return (
                                    <tr key={i} className="hover:bg-muted/20 transition-smooth">
                                      <td className="py-1 px-3 font-mono break-all align-top text-foreground/80 border-r border-border/50">
                                        {e.key}
                                      </td>
                                      <td className="py-1 px-3 font-mono break-all align-top text-foreground border-r border-border/50">
                                        {e.value}
                                      </td>
                                      <td className="py-1 px-3 align-top">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <div
                                              className={cn(
                                                "flex items-start gap-1.5 rounded-sm cursor-help",
                                                known ? "text-foreground/90 hover:text-foreground" : "text-muted-foreground hover:text-foreground/80"
                                              )}
                                            >
                                              <Info className="h-3 w-3 shrink-0 mt-0.5 opacity-70" />
                                              <div className="min-w-0 leading-snug">
                                                <div className="truncate text-[11px] font-medium">
                                                  {fieldInfo.label}
                                                </div>
                                                <div className="line-clamp-2 text-[10px] text-muted-foreground">
                                                  {fieldInfo.description}
                                                </div>
                                              </div>
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="left" className="max-w-sm max-h-[min(50vh,320px)] overflow-y-auto p-3 text-left space-y-2">
                                            {!known && (
                                              <p className="text-xs font-semibold text-warning dark:text-warning">Unknown parameter</p>
                                            )}
                                            <p className="font-mono text-xs text-foreground font-medium break-all">{e.key}</p>
                                            <p className="text-muted-foreground text-xs leading-snug">{fieldInfo.description}</p>
                                            {fieldInfo.options && (
                                              <div className="text-muted-foreground text-xs">
                                                <span className="text-foreground font-medium">Possible values:</span>
                                                <ul className="mt-0.5 ml-2 space-y-0.5">
                                                  {parseOptionsString(fieldInfo.options).map((opt, idx) => (
                                                    <li key={idx} className="font-mono">{opt}</li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}
                                          </TooltipContent>
                                        </Tooltip>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {filteredEntries.length === 0 && searchFilter.trim() && (
                              <EmptyState
                                compact
                                variant="inline"
                                icon={<Search />}
                                title={`No keys match "${searchFilter.trim()}"`}
                                description="Try a shorter key fragment or clear the filter."
                                className="p-6"
                              />
                            )}
                          </div>
                        ) : (
                          <EmptyState
                            variant="inline"
                            icon={<FileText />}
                            title="No parsed entries"
                            description="Content may be encrypted or in a non-standard format."
                            className="h-full p-10"
                            action={
                              <Button
                                size="sm"
                                variant="neutral"
                                className="h-8 gap-1.5 px-3 text-xs"
                                onClick={() => setConfigView("raw")}
                              >
                                <Code className="h-3.5 w-3.5" />
                                View Raw
                              </Button>
                            }
                          />
                        )}
                      </div>
                    )}

                    {/* ── RAW view ── */}
                    {configView === "raw" && (
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex-1 overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                          <pre className="font-mono text-xs leading-relaxed p-3 select-text">
                            {(result.raw || "").split("\n").map((line, i) => {
                              const trimmed = line.trim();
                              const isSectionBorder = /^#{3,}$/.test(trimmed);
                              const isSectionTitle = /^##\s+.+\s+##$/.test(trimmed);
                              const isComment = trimmed.startsWith("#") && !isSectionBorder && !isSectionTitle;
                              const isVersion = trimmed.startsWith("#!version");
                              const isEmpty = trimmed === "";
                              const eqIdx = !trimmed.startsWith("#") ? trimmed.indexOf("=") : -1;

                              if (isEmpty) return <span key={i} className="block h-4">{"\n"}</span>;
                              if (isSectionBorder) return <span key={i} className="block text-muted-foreground/60">{trimmed}{"\n"}</span>;
                              if (isSectionTitle) {
                                const titleMatch = trimmed.match(/^##\s+(.+?)\s+##$/);
                                const title = titleMatch?.[1] || trimmed;
                                return <span key={i} className="block text-foreground font-semibold">{"## "}<span className="text-foreground">{title}</span>{" ##\n"}</span>;
                              }
                              if (isVersion) return <span key={i} className="block text-muted-foreground/70 italic">{trimmed}{"\n"}</span>;
                              if (isComment) return <span key={i} className="block text-muted-foreground/60">{trimmed}{"\n"}</span>;
                              if (eqIdx > 0) {
                                const key = trimmed.slice(0, eqIdx).trimEnd();
                                const value = trimmed.slice(eqIdx + 1).trimStart();
                                return (
                                  <span key={i} className="block">
                                    <span className="text-foreground/80">{key}</span>
                                    <span className="text-muted-foreground/70">{" = "}</span>
                                    <span className="text-foreground">{value}</span>
                                    {"\n"}
                                  </span>
                                );
                              }
                              return <span key={i} className="block text-foreground/80">{trimmed}{"\n"}</span>;
                            })}
                          </pre>
                        </div>
                        {!result.parseable && (
                          <p className="surface-subtle text-xs text-muted-foreground px-3 py-1.5 border-t border-border/50">
                            Content could not be parsed as key-value (may be encrypted)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="diff" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-hidden ui-surface-card">
              <ProvisionDiffView result={result} />
            </div>
          </TabsContent>

          <TabsContent value="designer" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full w-full overflow-hidden ui-surface-card">
              <ProvisionDesigner
                result={result}
                initialModel={model}
                onModelChange={handleModelChange}
              />
            </div>
          </TabsContent>

          <TabsContent value="firmware" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 overflow-y-auto app-view-gutter">
              <FirmwareCatalogView />
            </div>
          </TabsContent>

        </AnimatedTabsContent>

        </div>
      </Tabs>

      {/* Provision → Registrar import wizard */}
      {registrarWizardOpen && result?.parsed?.entries && (
        <ProvisionRegistrarWizard
          open={registrarWizardOpen}
          onClose={() => setRegistrarWizardOpen(false)}
          entries={result.parsed.entries}
        />
      )}
    </div>
  );
}
