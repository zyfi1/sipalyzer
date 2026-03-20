import { invokeTauri } from "@/api/invoke";
import type { ReleaseChannel } from "@/lib/updater/channels";

export interface UpdaterReleaseInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  publishedAt: string | null;
}

export async function checkForUpdate(channel: ReleaseChannel): Promise<UpdaterReleaseInfo | null> {
  return invokeTauri<UpdaterReleaseInfo | null>("updater_check", { channel });
}

export async function installUpdate(channel: ReleaseChannel): Promise<UpdaterReleaseInfo | null> {
  return invokeTauri<UpdaterReleaseInfo | null>("updater_install", { channel });
}
