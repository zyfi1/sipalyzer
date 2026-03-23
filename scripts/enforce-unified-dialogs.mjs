import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMPONENTS_DIR = path.join(ROOT, "src", "components");

const ALLOWED_ALERT_DIALOG_IMPORTERS = new Set([
  path.join("src", "components", "ui", "alert-dialog.tsx"),
  path.join("src", "components", "ui", "confirm-dialog.tsx"),
]);

async function walkTsxFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkTsxFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join(path.posix.sep);
}

function hasRawAlertDialogImport(source) {
  return /from\s+["']@\/components\/ui\/alert-dialog["']/.test(source);
}

function hasRawDialogImport(source) {
  return /from\s+["']@\/components\/ui\/dialog["']/.test(source);
}

function hasConfirmDialogImport(source) {
  return /from\s+["']@\/components\/ui\/confirm-dialog["']/.test(source);
}

function hasConfirmationLikeDialogMarkup(source) {
  const titlePattern =
    /<DialogTitle[^>]*>\s*[^<>{}]*(are you sure|delete|remove|reset|confirm|warning)[^<>{}]*<\/DialogTitle>/i;
  const descriptionPattern =
    /<DialogDescription[^>]*>\s*[^<>{}]*(cannot be undone|this will|permanent(ly)?|are you sure)[^<>{}]*<\/DialogDescription>/i;
  return titlePattern.test(source) || descriptionPattern.test(source);
}

async function main() {
  const files = await walkTsxFiles(COMPONENTS_DIR);
  const violations = [];

  for (const file of files) {
    const rel = normalizeRelative(file);
    const source = await fs.readFile(file, "utf8");

    if (hasRawAlertDialogImport(source) && !ALLOWED_ALERT_DIALOG_IMPORTERS.has(rel)) {
      violations.push(
        `${rel}: raw alert-dialog import is forbidden; use ConfirmDialog from "@/components/ui/confirm-dialog".`,
      );
    }

    // Heuristic guard: confirmation-like wording + raw Dialog import should use ConfirmDialog.
    if (hasRawDialogImport(source) && hasConfirmationLikeDialogMarkup(source) && !hasConfirmDialogImport(source)) {
      violations.push(
        `${rel}: confirmation-like <DialogTitle>/<DialogDescription> detected. Prefer ConfirmDialog for confirmations.`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("Unified dialog guard failed:\n");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log("Unified dialog guard passed.");
}

main().catch((error) => {
  console.error("Failed to run unified dialog guard.");
  console.error(error);
  process.exit(1);
});

