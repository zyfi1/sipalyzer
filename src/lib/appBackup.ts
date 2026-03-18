import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { invokeTauri } from "@/api/invoke";
import {
  applyStateToStores,
  collectStateFromStores,
  saveSessionState,
  type SessionStateSchema,
} from "@/lib/sessionState";

const APP_BACKUP_KIND = "sipalyzer-full-app-backup";
const APP_BACKUP_VERSION = 1;

interface AppBackupEnvelope {
  kind: string;
  version: number;
  createdAt: string;
  appVersion: string;
  state: SessionStateSchema;
}

function createBackupEnvelope(state: SessionStateSchema): AppBackupEnvelope {
  return {
    kind: APP_BACKUP_KIND,
    version: APP_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: "1.0.0",
    state,
  };
}

function parseBackupEnvelope(text: string): AppBackupEnvelope {
  const parsed = JSON.parse(text) as Partial<AppBackupEnvelope>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file format.");
  }
  if (parsed.kind !== APP_BACKUP_KIND) {
    throw new Error("This file is not a SIPalyzer full app backup.");
  }
  if (typeof parsed.version !== "number") {
    throw new Error("Backup file is missing a valid version.");
  }
  if (!parsed.state || typeof parsed.state !== "object") {
    throw new Error("Backup file is missing app state.");
  }
  return parsed as AppBackupEnvelope;
}

async function writeBackupAudit(
  action: "backup_export" | "backup_restore",
  source: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await invokeTauri("admin_audit_write", {
      category: "settings",
      action,
      actor: "user",
      target: source,
      detail: JSON.stringify(detail),
    });
  } catch {
    // Audit failure should not block backup/restore.
  }
}

export async function exportFullAppBackup(source: string): Promise<string> {
  const state = collectStateFromStores();
  const envelope = createBackupEnvelope(state);
  const json = JSON.stringify(envelope, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const path = await saveExportFile(
    `sipalyzer-full-backup-${date}.json`,
    textToBase64(json),
    "JSON files",
    "json",
  );
  await writeBackupAudit("backup_export", source, {
    status: "success",
    path,
    stateVersion: state.version,
    backupVersion: envelope.version,
  });
  return path;
}

export async function restoreFullAppBackupFromText(
  text: string,
  source: string,
  fileName?: string,
): Promise<void> {
  const envelope = parseBackupEnvelope(text);
  applyStateToStores(envelope.state);
  await saveSessionState(collectStateFromStores());
  await writeBackupAudit("backup_restore", source, {
    status: "success",
    fileName: fileName ?? null,
    backupVersion: envelope.version,
    backupCreatedAt: envelope.createdAt,
    stateVersion: envelope.state.version ?? null,
  });
}

export async function auditBackupRestoreFailure(
  source: string,
  reason: string,
  fileName?: string,
): Promise<void> {
  await writeBackupAudit("backup_restore", source, {
    status: "failed",
    fileName: fileName ?? null,
    reason,
  });
}
