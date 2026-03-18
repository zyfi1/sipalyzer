import { create } from "zustand";
import { toolRegistry, ToolDefinition, HOME_TOOL_ID } from "@/lib/toolRegistry";
import type { FetchProvisionResult } from "@/types/provision";

/** Provision Viewer tool state (persisted via session state file). */
export interface ProvisionViewerData {
  result: FetchProvisionResult | null;
  providerUrl: string;
  mac: string;
  model: string;
  /** When true, send MAC in User-Agent (e.g. "Yealink SIP-T46G 28.81.0.25 00:15:65:74:b1:50"). Default true. */
  includeMacInUa: boolean;
  /** Auto-fetched mac-contact.file content (when URL present in provision). */
  contactsFileContent: string | null;
  contactsFileLoading: boolean;
  /** Last error when fetching contact file (e.g. HTTP 500) — shown in Contacts tab. */
  contactsFileError: string | null;
}

interface ToolState {
  activeToolId: string | null;
  /** The tool that was active before the current one (used for toggle-back on bottom tools). */
  previousToolId: string | null;
  /** When set, the active tool should switch to this subview (then clear after applying). */
  activeSubviewId: string | null;
  /** Which subview is shown per tool (for sidebar highlight). Tools set this when view changes. */
  lastViewedSubviews: Record<string, string>;
  /** Provision Viewer: last fetch result and form fields (persisted so leaving the tool doesn't clear it). */
  provisionViewerData: ProvisionViewerData;
  setActiveTool: (toolId: string, subviewId?: string) => void;
  setActiveSubview: (subviewId: string | null) => void;
  setLastViewedSubview: (toolId: string, subviewId: string) => void;
  setProvisionViewerResult: (result: FetchProvisionResult | null) => void;
  setProvisionViewerForm: (updates: Partial<Pick<ProvisionViewerData, "providerUrl" | "mac" | "model" | "includeMacInUa">>) => void;
  setProvisionViewerContactsFile: (content: string | null, loading: boolean, error?: string | null) => void;
  /** Clear all Provision Viewer state (result, form, contacts, errors). */
  setProvisionViewerClear: () => void;
  getActiveTool: () => ToolDefinition | undefined;
}

export const useToolStore = create<ToolState>((set, get) => ({
  activeToolId: HOME_TOOL_ID,
  previousToolId: null,
  activeSubviewId: null,
  lastViewedSubviews: {},
  provisionViewerData: {
    result: null,
    providerUrl: "",
    mac: "",
    model: "T46G",
    includeMacInUa: true,
    contactsFileContent: null,
    contactsFileLoading: false,
    contactsFileError: null,
  },

  setActiveTool: (toolId: string, subviewId?: string) => {
    const current = get().activeToolId;
    const updates: Partial<ToolState> = {
      activeToolId: toolId,
      activeSubviewId: subviewId ?? null,
      // Track previous tool for toggle-back (only when actually changing)
      ...(toolId !== current ? { previousToolId: current } : {}),
    };
    if (subviewId) {
      updates.lastViewedSubviews = {
        ...get().lastViewedSubviews,
        [toolId]: subviewId,
      };
    }
    set(updates);
  },

  setActiveSubview: (subviewId: string | null) => {
    set({ activeSubviewId: subviewId });
  },

  setLastViewedSubview: (toolId: string, subviewId: string) => {
    set((s) => ({
      lastViewedSubviews: { ...s.lastViewedSubviews, [toolId]: subviewId },
    }));
  },

  setProvisionViewerResult: (result) => {
    set((s) => ({
      provisionViewerData: {
        ...s.provisionViewerData,
        result,
        contactsFileContent: null,
        contactsFileLoading: false,
        contactsFileError: null,
      },
    }));
  },

  setProvisionViewerContactsFile: (content, loading, error) => {
    set((s) => ({
      provisionViewerData: {
        ...s.provisionViewerData,
        contactsFileContent: content,
        contactsFileLoading: loading,
        contactsFileError:
          error !== undefined ? error : content != null ? null : s.provisionViewerData.contactsFileError,
      },
    }));
  },

  setProvisionViewerForm: (updates) => {
    set((s) => ({
      provisionViewerData: {
        ...s.provisionViewerData,
        ...(updates.providerUrl !== undefined && { providerUrl: updates.providerUrl }),
        ...(updates.mac !== undefined && { mac: updates.mac }),
        ...(updates.model !== undefined && { model: updates.model }),
        ...(updates.includeMacInUa !== undefined && { includeMacInUa: updates.includeMacInUa }),
      },
    }));
  },

  setProvisionViewerClear: () => {
    set(() => ({
      provisionViewerData: {
        result: null,
        providerUrl: "",
        mac: "",
        model: "T46G",
        includeMacInUa: true,
        contactsFileContent: null,
        contactsFileLoading: false,
        contactsFileError: null,
      },
    }));
  },

  getActiveTool: () => {
    const { activeToolId } = get();
    if (!activeToolId) return undefined;
    return toolRegistry.get(activeToolId);
  },
}));
