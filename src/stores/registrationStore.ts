import { create } from "zustand";
import { extractErrorMessage, logError } from "@/lib/errorUtils";
import * as registrationApi from "@/api/registration";
import { getRegistrarPassword } from "@/api/registration";
import type { RegistrarFolder } from "@/api/registration";
import type { TestType, TestSuiteResult, BulkOperationResult } from "@/types/registration";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { dispatchRegistrationTest } from "@/lib/executionDispatch";
import type { NormalizedRegistrationResult } from "@/lib/resultNormalizers";

/**
 * Refresh the troubleshooting store's registration health data.
 * Called after any action that changes registration state so that
 * dependent views (softphone, fax) pick up the new status immediately.
 */
function refreshHealthAfterRegistration() {
  // Small delay to let the backend DB persist the result before we read it back
  setTimeout(() => {
    useTroubleshootingStore.getState().refresh();
  }, 300);
}

export interface Registrar {
  id?: string;
  name: string;
  domain: string;
  remote_port: number;
  local_port?: number;
  /** Local RTP port for media (UDP). SDP m= line and bind. Default 10000. */
  rtp_port?: number;
  /** Port to listen on for inbound SIP (UDP). If set, REGISTER Contact uses this so INVITEs reach the softphone. */
  listening_port?: number | null;
  transport: string;
  username: string;
  realm?: string;
  timeout_seconds: number;
  retry_count: number;
  register_interval_seconds?: number;
  tags: string[];
  group?: string | null;
  /** Comma-separated list of assigned views (e.g. "faxing", "calling", "faxing,calling"). */
  use_case?: string | null;
  /** Voicemail number / URI to dial for checking voicemail (e.g. "*97"). */
  voicemail_number?: string | null;
  /** Whether MWI (Message Waiting Indicator) subscription is enabled for this registrar. */
  mwi_enabled?: boolean;
  /** When true, auto-register on app startup. Default false — user must explicitly register. */
  auto_register?: boolean;
  /** Persisted display order for manual sorting. */
  sort_order?: number;
}

export interface RegistrationResult {
  success: boolean;
  status_code: number;
  status_text: string;
  response_time_ms: number;
  expires?: number;
  error?: string;
  request_message: string;
  response_message: string;
  /** Per-test packet capture session; review in Packet Monitor. */
  capture_session_id?: string;
  /** When this result was received (ISO string). Shown with response code. */
  timestamp?: string;
  /** Explicitly marks this registrar as intentionally unregistered/idle. */
  unregistered?: boolean;
}

/** Maps NormalizedRegistrationResult (from remote) to RegistrationResult (store type). */
function mapNormalizedToResult(n: NormalizedRegistrationResult): RegistrationResult {
  return {
    success: n.success,
    status_code: n.status_code,
    status_text: n.status_text,
    response_time_ms: n.elapsed_ms,
    expires: n.expires > 0 ? n.expires : undefined,
    error: n.error ?? undefined,
    request_message: "",
    response_message: "",
    timestamp: new Date().toISOString(),
  };
}

/** Derive a stable key from an ExecutionContext. */
function contextKey(ctx: ExecutionContext): string {
  if (ctx.type === "local") return "local";
  return ctx.agentId;
}

interface RegistrationState {
  registrars: Registrar[];
  folders: RegistrarFolder[];
  loading: boolean;
  error: string | null;
  selectedRegistrar: string | null;
  testResults: Record<string, RegistrationResult>;
  testSuites: Record<string, TestSuiteResult>;
  bulkOperationInProgress: boolean;
  bulkResults: BulkOperationResult[];
  lastSource: Record<string, { source: "local" | "remote"; agentId?: string }>;
  /** The context key ("local" | agentId) currently shown. */
  activeContextKey: string;
  /** Per-context saved test results so switching back restores remembered state. */
  savedContextResults: Record<string, Record<string, RegistrationResult>>;
  /** Switch execution context: saves current results, loads saved results for new context (or resets to unregistered). */
  switchRegistrationContext: (ctx: ExecutionContext) => void;
  fetchRegistrars: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  reorderFolders: (ids: string[]) => Promise<void>;
  reorderRegistrars: (ids: string[]) => Promise<void>;
  createRegistrar: (registrar: Omit<Registrar, "id">, password: string) => Promise<string>;
  updateRegistrar: (
    id: string,
    registrar: Partial<Registrar>,
    password?: string,
    options?: { optimistic?: boolean; refetch?: boolean }
  ) => Promise<void>;
  deleteRegistrar: (id: string) => Promise<void>;
  testRegistration: (id: string, ctx?: ExecutionContext, opts?: { unregister?: boolean }) => Promise<void>;
  runTestSuite: (registrarId: string, testTypes: TestType[], testConfigs?: Record<string, unknown>) => Promise<TestSuiteResult>;
  bulkTestRegistrars: (registrarIds: string[], testTypes: TestType[]) => Promise<BulkOperationResult[]>;
  bulkRegister: (registrarIds: string[]) => Promise<BulkOperationResult[]>;
  bulkUnregister: (registrarIds: string[]) => Promise<BulkOperationResult[]>;
  exportTestResults: (format: "html" | "pdf", registrarIds?: string[], filePath?: string | null) => Promise<string>;
  getTestSuiteResults: (registrarId: string, limit?: number) => Promise<unknown[]>;
  checkLocalPort: (port: number) => Promise<boolean>;
  getDefaultLocalPort: () => Promise<number>;
  setSelectedRegistrar: (id: string | null) => void;
}

// Store-level guard: prevents concurrent fetchRegistrars calls from racing.
let fetchInFlight = false;

function createUnregisteredResult(timestamp: string, statusText = "Not registered", statusCode = 0): RegistrationResult {
  return {
    success: true,
    status_code: statusCode,
    status_text: statusText,
    response_time_ms: 0,
    request_message: "",
    response_message: "",
    timestamp,
    unregistered: true,
  };
}

export const useRegistrationStore = create<RegistrationState>((set, get) => ({
  registrars: [],
  folders: [],
  loading: false,
  error: null,
  selectedRegistrar: null,
  testResults: {},
  testSuites: {},
  bulkOperationInProgress: false,
  bulkResults: [],
  lastSource: {},
  activeContextKey: "local",
  savedContextResults: {},

  switchRegistrationContext: (ctx) => {
    const state = get();
    const newKey = contextKey(ctx);
    const oldKey = state.activeContextKey;
    if (newKey === oldKey) return;

    // Save current results under the old context key
    const saved = { ...state.savedContextResults, [oldKey]: { ...state.testResults } };

    // Load saved results for the new context (or default to all unregistered)
    const restored = saved[newKey];
    if (restored && Object.keys(restored).length > 0) {
      set({
        activeContextKey: newKey,
        savedContextResults: saved,
        testResults: restored,
        testSuites: {},
        lastSource: {},
      });
    } else {
      // No saved state for this context — mark everything as unregistered
      const now = new Date().toISOString();
      const unregistered: Record<string, RegistrationResult> = {};
      for (const r of state.registrars) {
        if (!r.id) continue;
        unregistered[r.id] = createUnregisteredResult(now);
      }
      set({
        activeContextKey: newKey,
        savedContextResults: saved,
        testResults: unregistered,
        testSuites: {},
        lastSource: {},
      });
    }
  },

  fetchRegistrars: async () => {
    // Store-level re-entry guard: if a fetch is already in flight, skip.
    // This prevents concurrent calls (mount + click, bulk + refresh, etc.) from racing.
    if (fetchInFlight) return;
    fetchInFlight = true;

    // Don't clear testResults/testSuites upfront — keep old status visible while checks run.
    // Fresh results overwrite per-ID as each batch completes; stale IDs are pruned at the end.
    set({ loading: true, error: null });
    try {
      const [registrars, folders] = await Promise.all([
        registrationApi.listRegistrars(),
        registrationApi.listRegistrarFolders(),
      ]);
      const registrarsWithIds = registrars.map(r => ({
        ...r,
        id: r.id || undefined,
      }));
      set({ registrars: registrarsWithIds, folders });

      // Split registrars into auto-register (will send REGISTER) and manual (keep existing status).
      // When operating on a remote agent context, skip auto-register — those are local-only.
      const isRemoteContext = get().activeContextKey !== "local";
      const autoIds: string[] = [];
      const manualIds: string[] = [];
      for (const r of registrarsWithIds) {
        if (!r.id) continue;
        if (r.auto_register && !isRemoteContext) {
          autoIds.push(r.id);
        } else {
          manualIds.push(r.id);
        }
      }

      const now = new Date().toISOString();
      const existingResults = get().testResults;
      const freshResults: Record<string, RegistrationResult> = {};

      // Manual registrars: PRESERVE existing status if they have one (user may have
      // manually registered). Only set "unregistered" for registrars with no prior status.
      for (const id of manualIds) {
        if (existingResults[id]) {
          freshResults[id] = existingResults[id];
        } else {
          freshResults[id] = createUnregisteredResult(now);
        }
      }

      // Auto-register registrars: send real REGISTER requests in batches.
      const BATCH_SIZE = 8;
      for (let i = 0; i < autoIds.length; i += BATCH_SIZE) {
        const batch = autoIds.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((id) => registrationApi.testRegistration(id))
        );
        const batchResults: Record<string, RegistrationResult> = {};
        settled.forEach((outcome, j) => {
          const id = batch[j];
          if (id === undefined) return;
          if (outcome.status === "fulfilled") {
            batchResults[id] = { ...outcome.value, timestamp: outcome.value.timestamp ?? now };
          } else {
            batchResults[id] = {
              success: false,
              status_code: 0,
              status_text: "Check failed",
              response_time_ms: 0,
              error: outcome.reason?.message ?? String(outcome.reason),
              request_message: "",
              response_message: "",
              timestamp: now,
            };
          }
          freshResults[id] = batchResults[id];
        });
        // Progressive update: merge ONLY this batch's results to avoid overwriting
        // concurrent updates (e.g. from runTestSuite) with stale manual-registrar placeholders.
        set((s) => ({ testResults: { ...s.testResults, ...batchResults } }));
      }
      // Final: prune deleted registrar IDs but preserve concurrent updates from
      // runTestSuite / testRegistration that may have occurred during the fetch.
      const validIds = new Set(registrarsWithIds.map(r => r.id).filter(Boolean));
      set((s) => {
        const pruned: Record<string, RegistrationResult> = {};
        // Start from current state — includes progressive auto-register results
        // AND any concurrent updates from user-initiated registrations.
        for (const [id, result] of Object.entries(s.testResults)) {
          if (validIds.has(id)) {
            pruned[id] = result;
          }
        }
        // Fill in missing IDs from freshResults (new registrars not yet in state).
        for (const [id, result] of Object.entries(freshResults)) {
          if (validIds.has(id) && !(id in pruned)) {
            pruned[id] = result;
          }
        }
        return { testResults: pruned, testSuites: {}, loading: false };
      });
      // Refresh health so softphone/fax areas pick up new registration status
      refreshHealthAfterRegistration();
    } catch (error) {
      logError("fetchRegistrars", error);
      const errorMessage = extractErrorMessage(error);
      set({ error: errorMessage, loading: false });
    } finally {
      fetchInFlight = false;
    }
  },

  fetchFolders: async () => {
    try {
      const folders = await registrationApi.listRegistrarFolders();
      set({ folders });
    } catch (e) {
      logError("fetchFolders", e);
    }
  },

  createFolder: async (name) => {
    const id = await registrationApi.createRegistrarFolder(name);
    await get().fetchFolders();
    return id;
  },

  renameFolder: async (id, name) => {
    await registrationApi.renameRegistrarFolder(id, name);
    await get().fetchFolders();
  },

  deleteFolder: async (id) => {
    await registrationApi.deleteRegistrarFolder(id);
    // Folder deletion also ungroups registrars, so re-fetch both
    await Promise.all([get().fetchFolders(), registrationApi.listRegistrars().then(registrars => {
      set({ registrars: registrars.map(r => ({ ...r, id: r.id || undefined })) });
    })]);
  },

  reorderFolders: async (ids) => {
    await registrationApi.reorderRegistrarFolders(ids);
    await get().fetchFolders();
  },

  reorderRegistrars: async (ids) => {
    await registrationApi.reorderRegistrars(ids);
    // Optimistically reorder the local state to avoid a full fetch round-trip
    set((state) => {
      const ordered: typeof state.registrars = [];
      const byId = new Map(state.registrars.map((r) => [r.id, r]));
      for (const id of ids) {
        const r = byId.get(id);
        if (r) ordered.push(r);
      }
      // Append any that weren't in the ids list (shouldn't happen, but safe)
      for (const r of state.registrars) {
        if (!ids.includes(r.id!)) ordered.push(r);
      }
      return { registrars: ordered };
    });
  },

  createRegistrar: async (registrar, password) => {
    try {
      const id = await registrationApi.createRegistrar(registrar, password);
      await get().fetchRegistrars(); // fetchRegistrars manages its own loading state
      return id;
    } catch (error) {
      logError("createRegistrar", error);
      const errorMessage = extractErrorMessage(error);
      set({ error: errorMessage, loading: false });
      throw new Error(errorMessage);
    }
  },

  updateRegistrar: async (id, registrar, password, options) => {
    const useOptimistic = options?.optimistic ?? false;
    const shouldRefetch = options?.refetch ?? true;
    const previous = get().registrars;
    try {
      if (useOptimistic) {
        set((state) => ({
          registrars: state.registrars.map((r) => (r.id === id ? { ...r, ...registrar } : r)),
        }));
      }
      await registrationApi.updateRegistrar(id, registrar, password);
      if (shouldRefetch) {
        await get().fetchRegistrars(); // fetchRegistrars manages its own loading state
      }
    } catch (error) {
      if (useOptimistic) {
        set({ registrars: previous });
      }
      logError("updateRegistrar", error);
      const errorMessage = extractErrorMessage(error);
      set({ error: errorMessage, loading: false });
      throw new Error(errorMessage);
    }
  },

  deleteRegistrar: async (id) => {
    try {
      await registrationApi.deleteRegistrar(id);
      // fetchRegistrars prunes deleted IDs from testResults and clears testSuites.
      // It also manages its own loading state, so no need to set loading here.
      await get().fetchRegistrars();
    } catch (error) {
      logError("deleteRegistrar", error);
      set({ error: extractErrorMessage(error), loading: false });
    }
  },

  testRegistration: async (id, ctx, opts) => {
    if (!id) {
      console.error("testRegistration called with undefined id");
      return;
    }
    const registrar = get().registrars.find((r) => r.id === id);
    if (!registrar) {
      console.error("testRegistration: registrar not found", id);
      return;
    }
    set({ loading: true, error: null });
    const localFn = opts?.unregister
      ? () => registrationApi.unregisterRegistrar(id).then(r => ({
          success: r.success,
          status_code: r.status_code ?? 0,
          status_text: r.status_text ?? "",
          response_time_ms: 0,
          request_message: "",
          response_message: "",
          error: r.error,
        }))
      : () => registrationApi.testRegistrationWithCapture(id);
    try {
      const res = ctx
        ? await dispatchRegistrationTest(ctx, localFn, {
            registrar: registrar.domain,
            username: registrar.username,
            password: await getRegistrarPassword(id),
            port: registrar.remote_port,
            transport: registrar.transport,
            domain: registrar.domain,
            expires: registrar.register_interval_seconds,
            timeout_secs: registrar.timeout_seconds,
            unregister: opts?.unregister,
          })
        : { source: "local" as const, result: await localFn(), agentId: undefined };

      const result: RegistrationResult =
        res.source === "local"
          ? { ...res.result, timestamp: (res.result as RegistrationResult).timestamp ?? new Date().toISOString() }
          : mapNormalizedToResult(res.result as NormalizedRegistrationResult);

      set((state) => ({
        testResults: { ...state.testResults, [id]: result },
        loading: false,
        lastSource: {
          ...state.lastSource,
          [id]: {
            source: res.source,
            agentId: res.agentId,
          },
        },
      }));
      // Refresh health so softphone/fax areas pick up new registration status
      refreshHealthAfterRegistration();
    } catch (error) {
      logError("testRegistration", error);
      const errorMessage = extractErrorMessage(error);
      set({ error: errorMessage, loading: false });
      set((state) => ({
        testResults: {
          ...state.testResults,
          [id]: {
            success: false,
            status_code: 0,
            status_text: "Error",
            response_time_ms: 0,
            error: errorMessage,
            request_message: "",
            response_message: "",
            timestamp: new Date().toISOString(),
          },
        },
      }));
      refreshHealthAfterRegistration();
    }
  },

  checkLocalPort: async (port) => {
    try {
      return await registrationApi.checkLocalPort(port);
    } catch (error) {
      return false;
    }
  },

  getDefaultLocalPort: async () => {
    try {
      return await registrationApi.getDefaultLocalPort();
    } catch (error) {
      return 5060;
    }
  },

  runTestSuite: async (registrarId, testTypes, testConfigs?) => {
    if (!registrarId || !testTypes || testTypes.length === 0) {
      throw new Error("Invalid registrar ID or test types");
    }
    
    // Set loading state immediately and synchronously before any async work
    set({ loading: true, error: null });
    
    // Give React multiple frames to render the loading overlay before starting the blocking operation
    // This ensures the UI updates and the overlay is visible before the async call blocks
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 100); // Give React time to render the overlay
        });
      });
    });
    
    try {
      const result = await registrationApi.runTestSuite(registrarId, testTypes, testConfigs);
      
      // Atomically update both testSuites AND testResults so the UI status is immediately correct.
      // Sync registration-affecting tests into testResults so deriveStatus picks up the
      // fresh state in the same render cycle. Deregistration takes precedence if both ran.
      set((state) => {
        if (!state) return { loading: false };
        const updates: Partial<RegistrationState> = {
          testSuites: { ...state.testSuites, [registrarId]: result },
          loading: false,
        };
        const deregTest = result.tests.find(t => t.test_type === "deregistration");
        const basicTest = result.tests.find(t => t.test_type === "basic_registration");
        if (deregTest && deregTest.success) {
          updates.testResults = {
            ...state.testResults,
            [registrarId]: {
              ...deregTest.result,
              timestamp: new Date().toISOString(),
              unregistered: true,
            },
          };
        } else if (basicTest) {
          updates.testResults = {
            ...state.testResults,
            [registrarId]: {
              ...basicTest.result,
              timestamp: new Date().toISOString(),
            },
          };
        }
        return updates;
      });
      // Refresh health so softphone/fax areas pick up new registration status
      refreshHealthAfterRegistration();
      return result;
    } catch (error) {
      logError("runTestSuite", error);
      const errorMessage = extractErrorMessage(error);
      set((state) => ({
        ...state,
        error: errorMessage,
        loading: false,
        testResults: {
          ...state.testResults,
          [registrarId]: {
            success: false,
            status_code: 0,
            status_text: "Error",
            response_time_ms: 0,
            error: errorMessage,
            request_message: "",
            response_message: "",
            timestamp: new Date().toISOString(),
          },
        },
      }));
      throw new Error(errorMessage);
    }
  },

  bulkTestRegistrars: async (registrarIds, testTypes) => {
    if (!registrarIds || registrarIds.length === 0) {
      throw new Error("No registrars selected");
    }
    if (!testTypes || testTypes.length === 0) {
      throw new Error("No test types selected");
    }
    
    set({ bulkOperationInProgress: true, bulkResults: [], error: null });
    try {
      const results = await registrationApi.bulkTestRegistrars(registrarIds, testTypes);
      
      // Validate results before setting state
      const validResults = Array.isArray(results) ? results : [];
      set({ bulkOperationInProgress: false, bulkResults: validResults });
      return validResults;
    } catch (error) {
      logError("bulkTestRegistrars", error);
      const errorMessage = extractErrorMessage(error);
      set((state) => ({
        ...state,
        bulkOperationInProgress: false,
        error: errorMessage,
      }));
      throw new Error(errorMessage);
    }
  },

  bulkRegister: async (registrarIds) => {
    if (!registrarIds || registrarIds.length === 0) {
      throw new Error("No registrars selected");
    }
    
    set({ bulkOperationInProgress: true, bulkResults: [], error: null });
    try {
      const results = await registrationApi.bulkRegister(registrarIds);
      const validResults = Array.isArray(results) ? results : [];

      // Immediately sync testResults from the bulk operation results so status updates
      // without needing a separate fetchRegistrars call.
      const now = new Date().toISOString();
      set((state) => {
        const updatedTestResults = { ...state.testResults };
        for (const r of validResults) {
          const basicTest = r.result?.tests.find(t => t.test_type === "basic_registration");
          if (basicTest) {
            updatedTestResults[r.registrar_id] = {
              ...basicTest.result,
              timestamp: now,
            };
          } else {
            // No test suite detail — synthesize from the bulk result itself
            updatedTestResults[r.registrar_id] = {
              success: r.success,
              status_code: r.status_code ?? 0,
              status_text: r.status_text ?? (r.success ? "OK" : "Failed"),
              response_time_ms: r.response_time_ms ?? 0,
              error: r.error,
              request_message: "",
              response_message: "",
              timestamp: now,
            };
          }
        }
        return {
          bulkOperationInProgress: false,
          bulkResults: validResults,
          testResults: updatedTestResults,
        };
      });
      // Refresh health so softphone/fax areas pick up new registration status
      refreshHealthAfterRegistration();
      return validResults;
    } catch (error) {
      logError("bulkRegister", error);
      const errorMessage = extractErrorMessage(error);
      set((state) => ({
        ...state,
        bulkOperationInProgress: false,
        error: errorMessage,
      }));
      throw new Error(errorMessage);
    }
  },

  bulkUnregister: async (registrarIds) => {
    if (!registrarIds || registrarIds.length === 0) {
      throw new Error("No registrars selected");
    }
    
    set({ bulkOperationInProgress: true, bulkResults: [], error: null });
    try {
      const results = await registrationApi.bulkUnregister(registrarIds);
      const validResults = Array.isArray(results) ? results : [];

      // Immediately sync testResults — mark each as unregistered so UI updates instantly.
      const now = new Date().toISOString();
      set((state) => {
        const updatedTestResults = { ...state.testResults };
        for (const r of validResults) {
          if (r.success) {
            updatedTestResults[r.registrar_id] = createUnregisteredResult(
              now,
              r.status_text ?? "Unregistered",
              r.status_code ?? 200,
            );
          } else {
            updatedTestResults[r.registrar_id] = {
              success: false,
              status_code: r.status_code ?? 0,
              status_text: r.status_text ?? "Failed",
              response_time_ms: r.response_time_ms ?? 0,
              error: r.error,
              request_message: "",
              response_message: "",
              timestamp: now,
            };
          }
        }
        return {
          bulkOperationInProgress: false,
          bulkResults: validResults,
          testResults: updatedTestResults,
        };
      });
      // Refresh health so softphone/fax areas pick up new registration status
      refreshHealthAfterRegistration();
      return validResults;
    } catch (error) {
      logError("bulkUnregister", error);
      const errorMessage = extractErrorMessage(error);
      set((state) => ({
        ...state,
        bulkOperationInProgress: false,
        error: errorMessage,
      }));
      throw new Error(errorMessage);
    }
  },

  exportTestResults: async (format: "html" | "pdf", registrarIds?: string[], filePath?: string | null) => {
    try {
      const result = await registrationApi.exportTestResults(format, registrarIds, filePath ?? null);
      return result;
    } catch (error) {
      logError("exportTestResults", error);
      const errorMessage = extractErrorMessage(error);
      throw new Error(errorMessage);
    }
  },

  getTestSuiteResults: async (registrarId: string, limit?: number) => {
    try {
      return await registrationApi.getTestSuiteResults(registrarId, limit ?? 50);
    } catch (error) {
      logError("getTestSuiteResults", error);
      const errorMessage = extractErrorMessage(error);
      throw new Error(errorMessage);
    }
  },

  setSelectedRegistrar: (id) => {
    set({ selectedRegistrar: id });
  },
}));

function buildRegistrationActivityItems(state: RegistrationState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  if (state.loading) {
    rows.push({
      key: "registration-loading",
      name: "Registration checks",
      detail: "Refreshing registrar state",
      state: "running",
      cpuPct: 8,
      memMb: 88,
      startedAt: Date.now() - 8_000,
      kind: "registration",
    });
  }
  if (state.bulkOperationInProgress) {
    rows.push({
      key: "registration-bulk",
      name: "Registration bulk operation",
      detail: "Applying bulk register/unregister",
      state: "running",
      cpuPct: 10,
      memMb: 96,
      startedAt: Date.now() - 10_000,
      kind: "registration",
    });
  }
  return rows;
}

useRegistrationStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "registration-store",
    buildRegistrationActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "registration-store",
  buildRegistrationActivityItems(useRegistrationStore.getState()),
);
