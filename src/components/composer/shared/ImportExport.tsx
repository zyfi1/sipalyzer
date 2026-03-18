/**
 * Import/Export — Export entire collection as JSON, import from Postman/Insomnia formats.
 */

import { useState, useCallback, useRef } from "react";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { useComposerStore, newItemId, newFolderId } from "@/stores/composerStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToastContext } from "@/contexts/ToastContext";
import { Download, Upload, Copy, Check } from "@/lib/icons";
import type { ComposerItem, ComposerFolder } from "@/types/composer";

interface ImportExportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportExport({ open, onOpenChange }: ImportExportProps) {
  const collections = useComposerStore((s) => s.collections);
  const environments = useComposerStore((s) => s.environments);
  const addItem = useComposerStore((s) => s.addItem);
  const addFolder = useComposerStore((s) => s.addFolder);
  const toast = useToastContext();

  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportJson = useCallback(() => {
    const data = {
      version: 1,
      type: "sipalyzer-composer",
      exportedAt: new Date().toISOString(),
      collections,
      environments,
    };
    return JSON.stringify(data, null, 2);
  }, [collections, environments]);

  const handleCopyExport = useCallback(() => {
    navigator.clipboard.writeText(exportJson());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [exportJson]);

  const handleDownloadExport = useCallback(async () => {
    try {
      const json = exportJson();
      await saveExportFile(`composer-export-${new Date().toISOString().slice(0, 10)}.json`, textToBase64(json), "JSON files", "json");
      toast.success("Exported", "Collection exported as JSON file.", { source: "composer" });
    } catch {
      // User cancelled file dialog
    }
  }, [exportJson, toast]);

  // ── Import ────────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(reader.result as string);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleImport = useCallback(() => {
    if (!importText.trim()) {
      toast.warning("Empty Input", "Paste or load a JSON file first.", { source: "composer" });
      return;
    }

    try {
      const data = JSON.parse(importText);

      // Detect format
      if (data.type === "sipalyzer-composer") {
        // Native format
        importNativeFormat(data, addItem, addFolder);
      } else if (data.info && data.item) {
        // Postman Collection v2.1
        importPostmanFormat(data, addItem, addFolder);
      } else if (data._type === "export" && data.resources) {
        // Insomnia export
        importInsomniaFormat(data, addItem, addFolder);
      } else {
        toast.error("Unknown Format", "Could not detect the import format. Supported: SIPalyzer, Postman v2.1, Insomnia.", { source: "composer" });
        return;
      }

      toast.success("Imported", "Collection imported successfully.", { source: "composer" });
      setImportText("");
      onOpenChange(false);
    } catch (e) {
      toast.error("Import Failed", e instanceof Error ? e.message : "Invalid JSON.", { source: "composer" });
    }
  }, [importText, addItem, addFolder, toast, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Import / Export</DialogTitle>
          <DialogDescription>
            Export your collection or import from Postman, Insomnia, or a previous export.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="export" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="subview-tabs-compact mx-6 shrink-0">
            <TabsTrigger value="export" className="subview-tab-compact">
              <Download />
              Export
            </TabsTrigger>
            <TabsTrigger value="import" className="subview-tab-compact">
              <Upload />
              Import
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
            <TabsContent value="export" className="mt-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                Export {collections.items.length} items and {collections.folders.length} folders as JSON.
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={handleDownloadExport} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Download JSON
                </Button>
                <Button variant="neutral" onClick={handleCopyExport} className="gap-1.5">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy to Clipboard"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="import" className="mt-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste JSON or load a file. Supported formats: SIPalyzer export, Postman Collection v2.1, Insomnia export.
              </p>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button variant="neutral" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Load File
                </Button>
              </div>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste JSON here..."
                className="font-mono text-xs min-h-[150px]"
              />
              <Button onClick={handleImport} disabled={!importText.trim()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Import handlers ─────────────────────────────────────────────────────────

function importNativeFormat(
  data: { collections?: { items?: ComposerItem[]; folders?: ComposerFolder[] } },
  addItem: (item: ComposerItem) => void,
  addFolder: (folder: ComposerFolder) => void
) {
  const idMap = new Map<string, string>();

  for (const folder of data.collections?.folders ?? []) {
    const newId = newFolderId();
    idMap.set(folder.id, newId);
    addFolder({ ...folder, id: newId, parentId: null });
  }

  for (const item of data.collections?.items ?? []) {
    const folderId = item.folderId ? idMap.get(item.folderId) ?? null : null;
    addItem({ ...item, id: newItemId(), folderId });
  }
}

function importPostmanFormat(
  data: { item?: Array<{ name: string; request?: { method: string; url: { raw?: string } | string; header?: Array<{ key: string; value: string }> }; item?: unknown[] }> },
  addItem: (item: ComposerItem) => void,
  addFolder: (folder: ComposerFolder) => void
) {
  const now = Date.now();

  function processItems(items: typeof data.item, folderId: string | null) {
    if (!items) return;
    for (const pm of items) {
      if (pm.item && Array.isArray(pm.item)) {
        const fId = newFolderId();
        addFolder({
          id: fId,
          name: pm.name,
          parentId: folderId,
          order: 0,
          collapsed: false,
          createdAt: now,
        });
        processItems(pm.item as typeof data.item, fId);
      } else if (pm.request) {
        const url = typeof pm.request.url === "string" ? pm.request.url : pm.request.url?.raw ?? "";
        addItem({
          id: newItemId(),
          protocol: "http",
          name: pm.name,
          folderId,
          notes: "",
          color: "",
          createdAt: now,
          updatedAt: now,
          httpData: {
            method: pm.request.method || "GET",
            url,
            params: [],
            headers: pm.request.header?.map((h) => ({ key: h.key, value: h.value })) ?? [],
            bodyType: "none",
            bodyJson: "{}",
            bodyForm: [],
            bodyRaw: "",
            bodyRawContentType: "application/json",
            auth: { type: "none" },
          },
        });
      }
    }
  }

  processItems(data.item, null);
}

function importInsomniaFormat(
  data: { resources?: Array<{ _type: string; _id: string; parentId?: string; name?: string; method?: string; url?: string; headers?: Array<{ name: string; value: string }> }> },
  addItem: (item: ComposerItem) => void,
  addFolder: (folder: ComposerFolder) => void
) {
  const now = Date.now();
  const idMap = new Map<string, string>();

  for (const res of data.resources ?? []) {
    if (res._type === "request_group") {
      const fId = newFolderId();
      idMap.set(res._id, fId);
      addFolder({
        id: fId,
        name: res.name || "Folder",
        parentId: res.parentId ? idMap.get(res.parentId) ?? null : null,
        order: 0,
        collapsed: false,
        createdAt: now,
      });
    }
  }

  for (const res of data.resources ?? []) {
    if (res._type === "request") {
      addItem({
        id: newItemId(),
        protocol: "http",
        name: res.name || "Request",
        folderId: res.parentId ? idMap.get(res.parentId) ?? null : null,
        notes: "",
        color: "",
        createdAt: now,
        updatedAt: now,
        httpData: {
          method: res.method || "GET",
          url: res.url || "",
          params: [],
          headers: res.headers?.map((h) => ({ key: h.name, value: h.value })) ?? [],
          bodyType: "none",
          bodyJson: "{}",
          bodyForm: [],
          bodyRaw: "",
          bodyRawContentType: "application/json",
          auth: { type: "none" },
        },
      });
    }
  }
}
