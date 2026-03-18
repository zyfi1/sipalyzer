/**
 * Composer sidebar — request collections for SIP/HTTP.
 *
 * Focused layout:
 *   - Search bar
 *   - "New Request" button with SIP/HTTP options
 *   - Collection tree (folders + request items)
 *   - Environment selector at the bottom
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useComposerStore, newFolderId } from "@/stores/composerStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  Edit,
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Trash2,
  Copy,
  Play,
  Send,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EnvironmentEditor } from "./shared/EnvironmentEditor";
import { ImportExport } from "./shared/ImportExport";
import { getProtocolMeta, type ComposerCreatableProtocol } from "./protocolMeta";
import { ComposerEnvironmentSelect } from "./ComposerEnvironmentSelect";
import { ComposerCreateMenuItems } from "./ComposerCreateMenuItems";
import type { ComposerItem, ComposerFolder } from "@/types/composer";

function methodBadge(item: ComposerItem): string | null {
  switch (item.protocol) {
    case "http":
      return item.httpData?.method ?? "GET";
    case "sip":
      return item.sipData?.method ?? "OPTIONS";
    case "websocket":
      return "WS";
    case "graphql":
      return "GQL";
    default:
      return null;
  }
}

// ── Sidebar Component ───────────────────────────────────────────────────────

export function ComposerSidebar() {
  const collections = useComposerStore((s) => s.collections);
  const sidebarSearch = useComposerStore((s) => s.sidebarSearch);
  const setSidebarSearch = useComposerStore((s) => s.setSidebarSearch);
  const openTab = useComposerStore((s) => s.openTab);
  const createAndOpenItem = useComposerStore((s) => s.createAndOpenItem);
  const addFolder = useComposerStore((s) => s.addFolder);
  const updateFolder = useComposerStore((s) => s.updateFolder);
  const deleteItem = useComposerStore((s) => s.deleteItem);
  const duplicateItem = useComposerStore((s) => s.duplicateItem);
  const deleteFolder = useComposerStore((s) => s.deleteFolder);
  const toggleFolderCollapsed = useComposerStore((s) => s.toggleFolderCollapsed);
  const activeTabId = useComposerStore((s) => s.activeTabId);

  const [deleteTarget, setDeleteTarget] = useState<{ type: "item" | "folder"; id: string } | null>(null);
  const [envEditorOpen, setEnvEditorOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);

  const handleCreateFolder = useCallback(() => {
    const maxOrder = collections.folders.length
      ? Math.max(...collections.folders.map((f) => f.order))
      : 0;
    addFolder({
      id: newFolderId(),
      name: "New Folder",
      parentId: null,
      order: maxOrder + 1,
      collapsed: false,
      createdAt: Date.now(),
    });
  }, [addFolder, collections.folders]);

  const handleRenameFolder = useCallback((folderId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const existing = collections.folders.find((f) => f.id === folderId);
    if (!existing || existing.name === trimmed) return;
    updateFolder(folderId, { name: trimmed });
  }, [collections.folders, updateFolder]);

  // Filter to request items only (exclude SSH — that's in the SSH subview)
  const requestItems = useMemo(
    () => collections.items.filter((i) => i.protocol !== "ssh"),
    [collections.items]
  );

  // Apply search filter
  const filteredItems = useMemo(() => {
    if (!sidebarSearch) return requestItems;
    const lower = sidebarSearch.toLowerCase();
    return requestItems.filter(
      (i) =>
        i.name.toLowerCase().includes(lower) ||
        i.protocol.toLowerCase().includes(lower) ||
        (i.httpData?.url ?? "").toLowerCase().includes(lower) ||
        (i.sipData?.uri ?? "").toLowerCase().includes(lower)
    );
  }, [requestItems, sidebarSearch]);

  // Group items by folder
  const rootItems = filteredItems.filter((i) => !i.folderId);
  const itemsByFolder = useMemo(() => {
    const map = new Map<string, ComposerItem[]>();
    for (const item of filteredItems) {
      if (item.folderId) {
        const list = map.get(item.folderId) ?? [];
        list.push(item);
        map.set(item.folderId, list);
      }
    }
    return map;
  }, [filteredItems]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Search ───────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search requests..."
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            className="h-7 pl-8 text-xs"
          />
        </div>
      </div>

      {/* ── Sidebar actions ────────────────────────────────────────────── */}
      <div className="px-3 pb-2 shrink-0 flex items-center gap-1.5">
        <Button variant="primary" size="xs" className="flex-1 justify-start" onClick={handleCreateFolder}>
          <Plus className="h-3 w-3" />
          Create Folder
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Open import and export"
          onClick={() => setImportExportOpen(true)}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── Collection tree ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {requestItems.length === 0 && collections.folders.length === 0 ? (
          <EmptyState
            compact
            variant="inline"
            icon={<Send />}
            title="No requests yet"
            description="Create a SIP or HTTP request to get started."
          />
        ) : (
          <div className="space-y-0.5">
            {collections.folders.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                items={itemsByFolder.get(folder.id) ?? []}
                activeTabId={activeTabId}
                onOpenTab={openTab}
                onToggle={toggleFolderCollapsed}
                onCreateInFolder={(folderId, protocol) => createAndOpenItem(protocol, undefined, folderId)}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={(id) => setDeleteTarget({ type: "folder", id })}
                onDeleteItem={(id) => setDeleteTarget({ type: "item", id })}
                onDuplicateItem={duplicateItem}
              />
            ))}
            {rootItems.map((item) => (
              <ItemNode
                key={item.id}
                item={item}
                isActive={activeTabId === item.id}
                onOpen={() => openTab(item.id)}
                onDelete={() => setDeleteTarget({ type: "item", id: item.id })}
                onDuplicate={() => duplicateItem(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Environment selector (compact, at bottom) ─────────────────── */}
      <div className="px-3 py-2 shrink-0 border-t border-border/20">
        <ComposerEnvironmentSelect
          className="w-full"
          showManageButton
          onManage={() => setEnvEditorOpen(true)}
        />
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.type === "folder" ? "Delete Folder" : "Delete Request"}
        description={
          deleteTarget?.type === "folder"
            ? "Items inside will be moved to the root level."
            : "This will permanently remove this request."
        }
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget?.type === "folder") deleteFolder(deleteTarget.id);
          else if (deleteTarget?.type === "item") deleteItem(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
      <EnvironmentEditor open={envEditorOpen} onOpenChange={setEnvEditorOpen} />
      <ImportExport open={importExportOpen} onOpenChange={setImportExportOpen} />
    </div>
  );
}

// ── Folder tree node ────────────────────────────────────────────────────────

function FolderNode({
  folder,
  items,
  activeTabId,
  onOpenTab,
  onToggle,
  onCreateInFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteItem,
  onDuplicateItem,
}: {
  folder: ComposerFolder;
  items: ComposerItem[];
  activeTabId: string | null;
  onOpenTab: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateInFolder: (folderId: string, protocol: ComposerCreatableProtocol) => void;
  onRenameFolder: (folderId: string, nextName: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onDuplicateItem: (id: string) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isRenaming) setDraftName(folder.name);
  }, [folder.name, isRenaming]);

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  const commitRename = useCallback(() => {
    const trimmed = draftName.trim();
    setIsRenaming(false);
    if (!trimmed) {
      setDraftName(folder.name);
      return;
    }
    onRenameFolder(folder.id, trimmed);
  }, [draftName, folder.id, folder.name, onRenameFolder]);

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-smooth">
        <button
          type="button"
          onClick={() => onToggle(folder.id)}
          className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-left rounded-lg focus-visible:shadow-focus"
        >
          {folder.collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-2xs text-muted-foreground/60 shrink-0">{items.length}</span>
        </button>
        <button
          type="button"
          aria-label={`Rename folder ${folder.name}`}
          onClick={() => {
            setDraftName(folder.name);
            setIsRenaming(true);
          }}
          className="mr-1 shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted/50 hover:text-foreground transition-smooth"
        >
          <Edit className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          aria-label={`Delete folder ${folder.name}`}
          onClick={() => onDeleteFolder(folder.id)}
          className="mr-1 shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted/50 hover:text-destructive transition-smooth"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Create request in ${folder.name}`}
              className="mr-1 shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted/50 hover:text-foreground transition-smooth"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <ComposerCreateMenuItems onCreate={(protocol) => onCreateInFolder(folder.id, protocol)} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isRenaming ? (
        <div className="px-2 pb-1">
          <Input
            ref={renameInputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraftName(folder.name);
                setIsRenaming(false);
              }
            }}
            className="h-7 text-xs"
            aria-label={`Rename folder ${folder.name}`}
          />
        </div>
      ) : null}
      {!folder.collapsed && items.length > 0 && (
        <div className="ml-4 border-l border-border/20 pl-1 space-y-0.5">
          {items.map((item) => (
            <ItemNode
              key={item.id}
              item={item}
              isActive={activeTabId === item.id}
              onOpen={() => onOpenTab(item.id)}
              onDelete={() => onDeleteItem(item.id)}
              onDuplicate={() => onDuplicateItem(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Item tree node ──────────────────────────────────────────────────────────

function ItemNode({
  item,
  isActive,
  onOpen,
  onDelete,
  onDuplicate,
}: {
  item: ComposerItem;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const method = methodBadge(item);
  const meta = getProtocolMeta(item.protocol);
  const ProtocolIcon = meta.icon;

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg text-xs transition-smooth",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left rounded-lg focus-visible:shadow-focus"
      >
        <span className={meta.colorClass}>
          <ProtocolIcon className="h-3 w-3 shrink-0" />
        </span>
        {method && (
          <Badge
            variant="secondary"
            className="text-3xs px-1 py-0 font-mono shrink-0 h-4 leading-none"
          >
            {method}
          </Badge>
        )}
        <span className="truncate flex-1">{item.name}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Open actions menu for ${item.name}`}
            className={cn(
              "shrink-0 mr-1 p-0.5 rounded transition-smooth",
              isActive
                ? "opacity-70 hover:opacity-100 hover:bg-muted/50"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted/50"
            )}
          >
            <MoreVertical className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onSelect={() => onOpen()}>
            <Play className="h-3 w-3 mr-2" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicate()}>
            <Copy className="h-3 w-3 mr-2" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onDelete}
            variant="destructive"
          >
            <Trash2 className="h-3 w-3 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
