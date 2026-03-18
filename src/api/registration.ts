/**
 * Registration API — typed wrappers for all registration backend commands.
 */

import { invokeTauri } from "./invoke";
import type { RegistrationHealthResponse } from "@/types/forensics";
import type { TestType, TestSuiteResult, BulkOperationResult } from "@/types/registration";
import type { Registrar } from "@/stores/registrationStore";

export interface RegistrationResult {
  success: boolean;
  status_code: number;
  status_text: string;
  response_time_ms: number;
  expires?: number;
  error?: string;
  request_message: string;
  response_message: string;
  capture_session_id?: string;
  /** When this result was received (ISO string). Set by frontend when storing. */
  timestamp?: string;
  /** Explicit idle state after unregister. */
  unregistered?: boolean;
}

export async function getRegistrationHealth(): Promise<RegistrationHealthResponse> {
  return invokeTauri<RegistrationHealthResponse>("get_registration_health", {});
}

export async function listRegistrars(): Promise<Registrar[]> {
  return invokeTauri<Registrar[]>("list_registrars", {});
}

export async function createRegistrar(
  registrar: Omit<Registrar, "id">,
  password: string
): Promise<string> {
  return invokeTauri<string>("create_registrar", { registrar, password });
}

export async function updateRegistrar(
  id: string,
  registrar: Partial<Registrar>,
  password?: string
): Promise<void> {
  return invokeTauri<void>("update_registrar", { id, registrar, password });
}

export async function deleteRegistrar(id: string): Promise<void> {
  return invokeTauri<void>("delete_registrar", { id });
}

export async function getRegistrarPassword(id: string): Promise<string> {
  return invokeTauri<string>("get_registrar_password", { id });
}

/** Runs a real REGISTER against the server (no packet capture). Use for status checks on load. */
export async function testRegistration(id: string): Promise<RegistrationResult> {
  return invokeTauri<RegistrationResult>("test_registration", { id });
}

export async function testRegistrationWithCapture(id: string): Promise<RegistrationResult> {
  return invokeTauri<RegistrationResult>("test_registration_with_capture", { id });
}

export async function runTestSuite(
  registrarId: string,
  testTypes: TestType[],
  testConfigs?: Record<string, unknown>
): Promise<TestSuiteResult> {
  return invokeTauri<TestSuiteResult>("run_test_suite", {
    args: { id: registrarId, testTypes, testConfigs: testConfigs ?? null },
  });
}

export async function bulkTestRegistrars(
  registrarIds: string[],
  testTypes: TestType[]
): Promise<BulkOperationResult[]> {
  return invokeTauri<BulkOperationResult[]>("bulk_test_registrars", {
    ids: registrarIds,
    testTypes,
  });
}

export async function bulkRegister(registrarIds: string[]): Promise<BulkOperationResult[]> {
  return invokeTauri<BulkOperationResult[]>("bulk_register", { ids: registrarIds });
}

export async function bulkUnregister(registrarIds: string[]): Promise<BulkOperationResult[]> {
  return invokeTauri<BulkOperationResult[]>("bulk_unregister", { ids: registrarIds });
}

export async function unregisterRegistrar(id: string): Promise<{ success: boolean; status_code?: number; status_text?: string; error?: string }> {
  return invokeTauri("unregister_registrar", { id });
}

export async function exportTestResults(
  format: "html" | "pdf",
  registrarIds?: string[],
  filePath?: string | null
): Promise<string> {
  return invokeTauri<string>("export_test_results", {
    registrarIds,
    format,
    filePath: filePath ?? null,
  });
}

export async function getTestSuiteResults(
  registrarId: string,
  limit?: number
): Promise<unknown[]> {
  const results = await invokeTauri<unknown[]>("get_test_suite_results", {
    registrarId,
    limit: limit ?? 50,
  });
  return Array.isArray(results) ? results : [];
}

export async function checkLocalPort(port: number): Promise<boolean> {
  return invokeTauri<boolean>("check_local_port", { port });
}

export async function getDefaultLocalPort(): Promise<number> {
  return invokeTauri<number>("get_default_local_port", {});
}

export async function clearTestResults(registrarId: string | null): Promise<number> {
  return invokeTauri<number>("clear_test_results", { registrarId });
}

// ── Registrar Folders ──────────────────────────────────────────────────

export interface RegistrarFolder {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export async function listRegistrarFolders(): Promise<RegistrarFolder[]> {
  return invokeTauri<RegistrarFolder[]>("list_registrar_folders", {});
}

export async function createRegistrarFolder(name: string): Promise<string> {
  return invokeTauri<string>("create_registrar_folder", { name });
}

export async function renameRegistrarFolder(id: string, name: string): Promise<void> {
  return invokeTauri<void>("rename_registrar_folder", { id, name });
}

export async function deleteRegistrarFolder(id: string): Promise<void> {
  return invokeTauri<void>("delete_registrar_folder", { id });
}

export async function reorderRegistrarFolders(ids: string[]): Promise<void> {
  return invokeTauri<void>("reorder_registrar_folders", { ids });
}

export async function reorderRegistrars(ids: string[]): Promise<void> {
  return invokeTauri<void>("reorder_registrars", { ids });
}
