/**
 * Provision Viewer API — fetch Yealink/Poly provisioning file via Tauri.
 */

import { invokeTauri } from "./invoke";
import type { FetchProvisionResult } from "@/types/provision";

export async function fetchProvisionFile(
  providerUrl: string,
  mac: string,
  model: string,
  options?: { includeMacInUa?: boolean; vendor?: string; userAgent?: string }
): Promise<FetchProvisionResult> {
  const args = {
    providerUrl: providerUrl.trim() || "",
    mac: mac.trim() || "",
    model: model || "T46G",
    ...(options?.includeMacInUa !== undefined && { includeMacInUa: options.includeMacInUa }),
    ...(options?.vendor && { vendor: options.vendor }),
    ...(options?.userAgent?.trim() && { userAgent: options.userAgent.trim() }),
  };
  return invokeTauri<FetchProvisionResult>("fetch_provision_file", { args });
}

/** Fetch a URL (e.g. mac-contact.file) and return body as text. Pass userAgent (e.g. from provision request) to avoid 403/500 from servers that require Yealink UA. */
export async function fetchUrl(url: string, userAgent?: string | null): Promise<string> {
  const payload: { url: string; userAgent?: string } = { url: url.trim() };
  if (userAgent?.trim()) payload.userAgent = userAgent.trim();
  return invokeTauri<string>("fetch_url", payload);
}

/** Fetch an image URL and return it as a base64 data URL (data:image/...;base64,...). Bypasses CORS by fetching through the Tauri backend. */
export async function fetchImageBase64(url: string, userAgent?: string | null): Promise<string> {
  const payload: { url: string; userAgent?: string } = { url: url.trim() };
  if (userAgent?.trim()) payload.userAgent = userAgent.trim();
  return invokeTauri<string>("fetch_image_base64", payload);
}
