import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Trash2, Star, History, Link2, Check, Loader2, MoreHorizontal, X, Tag, Edit, Plus } from "@/lib/icons";
import { TipTapEditor } from "./editor/TipTapEditor";
import { useNoteStore } from "@/stores/noteStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import type { Note } from "@/types/notes";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/dateTime";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";


interface NoteDetailPanelProps {
  note: Note;
  onBack: () => void;
  onDeleted: () => void;
  initialEditMode?: boolean;
  onConsumedEditMode?: () => void;
}

const HOME_QUICK_NOTE_TITLE = "Home Quick Note";
const HOME_QUICK_NOTE_PROTECTED_TAG = "home-quick-note-protected";
const HOME_QUICK_NOTE_CATEGORY = "Home";

function isProtectedHomeQuickNote(note: Pick<Note, "title" | "tags"> | null | undefined): boolean {
  if (!note) return false;
  if (note.tags?.includes(HOME_QUICK_NOTE_PROTECTED_TAG)) return true;
  return note.title === HOME_QUICK_NOTE_TITLE;
}

export function NoteDetailPanel({ note, onBack, onDeleted, initialEditMode, onConsumedEditMode }: NoteDetailPanelProps) {
  const updateNote = useNoteStore((s) => s.updateNote);
  const updateNoteQuiet = useNoteStore((s) => s.updateNoteQuiet);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const fetchVersions = useNoteStore((s) => s.fetchVersions);
  const restoreVersion = useNoteStore((s) => s.restoreVersion);
  const registrars = useRegistrationStore((s) => s.registrars);
  const allNotes = useNoteStore((s) => s.notes);

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [category, setCategory] = useState<string>(note.category || "");
  const [isPinned, setIsPinned] = useState(!!note.isPinned);
  const [folderId] = useState<string | undefined>(note.folderId);
  const [linkedRegistrarId, setLinkedRegistrarId] = useState<string | undefined>(note.linkedRegistrarId);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>(note.linkedNoteIds || []);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [newTagName, setNewTagName] = useState("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versions = useNoteStore((s) => s.versions[note.id] || []);
  const autoSaveEnabled = useNoteStore((s) => s.autoSaveEnabled);

  const prevNoteIdRef = useRef(note.id);
  const lastSavedRef = useRef({ title: note.title, content: note.content });
  const isProtectedQuickNote = isProtectedHomeQuickNote(note);


  useEffect(() => {
    if (prevNoteIdRef.current !== note.id) {
      prevNoteIdRef.current = note.id;
      setTitle(note.title);
      setContent(note.content);
      setTags(note.tags);
      setCategory(isProtectedHomeQuickNote(note) ? HOME_QUICK_NOTE_CATEGORY : (note.category || ""));
      setIsPinned(!!note.isPinned);
      setLinkedRegistrarId(note.linkedRegistrarId);
      setLinkedNoteIds(note.linkedNoteIds || []);
      setAutoSaveStatus("idle");
      lastSavedRef.current = { title: note.title, content: note.content };
    }
  }, [note.id, note.title, note.content, note.tags, note.category, note.isPinned, note.folderId, note.linkedRegistrarId, note.linkedNoteIds]);

  // Consume initialEditMode for compatibility (always editing)
  useEffect(() => {
    if (initialEditMode) onConsumedEditMode?.();
  }, [initialEditMode, onConsumedEditMode]);

  const allCategories = useNoteStore((s) => {
    const cats = new Set<string>();
    s.notes.forEach((n) => n.category && cats.add(n.category));
    return Array.from(cats).sort();
  });
  const allTags = useNoteStore((s) => s.allTags);

  // Auto-save (3s debounce)
  const performAutoSave = useCallback(async () => {
    if (title === lastSavedRef.current.title && content === lastSavedRef.current.content) return;
    setAutoSaveStatus("saving");
    try {
      await updateNoteQuiet(
        note.id,
        title,
        content,
        tags,
        isProtectedQuickNote ? HOME_QUICK_NOTE_CATEGORY : (category || undefined),
        isPinned,
        linkedNoteIds.length > 0 ? linkedNoteIds : undefined,
        folderId,
        linkedRegistrarId,
        note.linkedAgentId,
      );
      lastSavedRef.current = { title, content };
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 2000);
    } catch { setAutoSaveStatus("idle"); }
  }, [note.id, title, content, tags, category, isPinned, linkedNoteIds, folderId, linkedRegistrarId, note.linkedAgentId, updateNoteQuiet, isProtectedQuickNote]);

  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(performAutoSave, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [title, content, autoSaveEnabled, performAutoSave]);

  useEffect(() => { lastSavedRef.current = { title: note.title, content: note.content }; }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateNote(
        note.id,
        title,
        content,
        tags,
        isProtectedQuickNote ? HOME_QUICK_NOTE_CATEGORY : (category || undefined),
        isPinned,
        linkedNoteIds.length > 0 ? linkedNoteIds : undefined,
        folderId,
        linkedRegistrarId,
        note.linkedAgentId,
      );
      lastSavedRef.current = { title, content };
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 2000);
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (isProtectedQuickNote) return;
    await deleteNote(note.id);
    setDeleteOpen(false);
    onDeleted();
  };

  const handleHistoryOpen = async () => { setHistoryOpen(true); await fetchVersions(note.id); };

  const handleRestoreVersion = async (versionId: string) => { await restoreVersion(versionId); setHistoryOpen(false); };

  const formatNoteDate = (dateString: string) => formatDateTime(dateString, { dateStyle: "medium", timeStyle: "short" });

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDateTime(dateString, { dateStyle: "medium" });
  };

  const formatShortDate = (dateString: string) => formatDateTime(dateString, { dateStyle: "medium" });
  const registrarName = linkedRegistrarId
    ? (registrars.find((r) => r.id === linkedRegistrarId)?.name ?? "Registrar")
    : null;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const characterCount = content.replace(/\s/g, "").length;
  const availableTags = allTags.filter((t) => !tags.includes(t));
  const handleCreateTag = useCallback(() => {
    const tag = newTagName.trim();
    if (!tag || tags.includes(tag)) return;
    setTags((prev) => [...prev, tag]);
    setNewTagName("");
  }, [newTagName, tags]);

  const autoSaveText = saving || autoSaveStatus === "saving"
    ? "Saving..."
    : autoSaveStatus === "saved"
      ? "Auto-saved"
      : autoSaveEnabled
        ? "Auto-save on"
        : "Auto-save off";

  useKeyboardShortcuts({
    "ctrl+s": (e) => { e.preventDefault(); handleSave(); },
    "ctrl+shift+p": (e) => { e.preventDefault(); setIsPinned(!isPinned); },
    escape: (e) => {
      if (historyOpen) { e.preventDefault(); setHistoryOpen(false); }
      else { e.preventDefault(); onBack(); }
    },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="notes-detail-topbar flex-shrink-0 ui-sticky-header">
        <div className="px-4 md:px-6 lg:px-8 h-11 flex items-center gap-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TooltipWrapper title="Back" description="Return to list (Esc)">
              <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
            <Edit className="h-3.5 w-3.5 text-muted-foreground/85 shrink-0" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="h-7 w-full min-w-0 bg-transparent border-0 outline-none text-[15px] font-semibold text-foreground placeholder:text-muted-foreground/45"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <TooltipWrapper title="Version history" description="Open note versions">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleHistoryOpen}>
                <History className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title={isPinned ? "Unpin note" : "Pin note"}>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-8 w-8 p-0 text-muted-foreground", isPinned && "text-warning")}
                onClick={() => setIsPinned(!isPinned)}
              >
                <Star className={cn("h-4 w-4", isPinned && "fill-current")} />
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title="Save now" description="Save changes immediately (Ctrl+S)">
              <Button variant="neutral" size="sm" className="h-8 text-xs gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </Button>
            </TooltipWrapper>
            <span className="hidden lg:inline-flex items-center text-[10px] text-muted-foreground tabular-nums px-2 py-1 rounded-md border border-border/35 bg-muted/20">
              {autoSaveText}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-1.5">
                <div className="px-2 py-2 space-y-3">
                  <MetaSelect
                    label="Category"
                    value={category || "__none__"}
                    onChange={(v) => setCategory(v === "__none__" ? "" : v)}
                  >
                    <SelectItem value="__none__">None</SelectItem>
                    {allCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </MetaSelect>

                  <MetaSelect
                    label="Registrar"
                    value={linkedRegistrarId || "__none__"}
                    onChange={(v) => setLinkedRegistrarId(v === "__none__" ? undefined : v)}
                  >
                    <SelectItem value="__none__">None</SelectItem>
                    {registrars.map((r) => <SelectItem key={r.id!} value={r.id!}>{r.name}</SelectItem>)}
                  </MetaSelect>
                </div>

                <DropdownMenuSeparator />

                <div className="px-2 py-2 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Link2 className="h-3.5 w-3.5" />
                    Linked notes
                  </div>
                  {linkedNoteIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {linkedNoteIds.map((lnId) => {
                        const ln = allNotes.find((n) => n.id === lnId);
                        if (!ln) return null;
                        return (
                          <Badge key={lnId} variant="secondary" className="text-2xs gap-1 pr-1 max-w-full">
                            <span className="truncate">{ln.title}</span>
                            <button
                              onClick={() => setLinkedNoteIds(prev => prev.filter(id => id !== lnId))}
                              className="ml-0.5 hover:text-destructive transition-smooth"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="neutral" size="sm" className="h-7 text-xs gap-1.5 w-full">
                        <Link2 className="h-3 w-3" />
                        Link a note
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search notes..." className="h-8" />
                        <CommandList>
                          <CommandEmpty>No notes found</CommandEmpty>
                          <CommandGroup>
                            {allNotes
                              .filter((n) => n.id !== note.id && !linkedNoteIds.includes(n.id))
                              .slice(0, 10)
                              .map((n) => (
                                <CommandItem
                                  key={n.id}
                                  onSelect={() => setLinkedNoteIds(prev => [...prev, n.id])}
                                  className="text-xs"
                                >
                                  {n.title}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {!isProtectedQuickNote && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-4 w-4" />
                      Delete note
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        <div className="h-full max-w-none w-full px-5 md:px-6 lg:px-8 pt-3 pb-3 flex flex-col min-h-0">
          <div className="notes-meta-manager notes-meta-strip rounded-md border border-border/35 px-2.5 py-1.5 mb-3">
            <div className="notes-meta-strip-scroll flex items-center gap-1.5 min-w-0 overflow-x-auto whitespace-nowrap">
              <div className="inline-flex items-center gap-1.5 min-w-0 shrink-0">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value="__add__" onValueChange={(v) => { if (v && v !== "__add__" && !tags.includes(v)) setTags([...tags, v]); }}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue placeholder="Add tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__add__">Add tag</SelectItem>
                    {availableTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Create tag">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2.5 space-y-2">
                  <p className="text-xs text-muted-foreground">Create tag</p>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Tag name"
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateTag();
                        }
                      }}
                    />
                    <Button size="sm" className="h-8 text-xs" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                      Add
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="h-6 text-[11px] gap-1 pr-1.5 shrink-0 max-w-[140px]">
                  <span className="truncate">{tag}</span>
                  <button
                    onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    className="hover:text-destructive transition-smooth"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}

              <Badge variant="outline" className="h-6 text-[11px] shrink-0">
                {tags.length} tag{tags.length === 1 ? "" : "s"}
              </Badge>
              {category && <Badge variant="outline" className="h-6 text-[11px] shrink-0 hidden xl:inline-flex">{category}</Badge>}
              {registrarName && <Badge variant="outline" className="h-6 text-[11px] shrink-0 hidden xl:inline-flex">{registrarName}</Badge>}
              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0 pl-2">
                Edited {formatRelativeDate(note.updatedAt)}
              </span>
            </div>
          </div>

          {/* Editor */}
          <TipTapEditor
            key={note.id}
            content={content}
            onChange={setContent}
            className="notes-editor-shell flex-1 min-h-0 rounded-xl border border-border/30"
            autoFocus={note.title === "Untitled" && !note.content.trim()}
            placeholder="Start writing..."
          />
          <div className="border-t border-border/15 mt-3 pt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 tabular-nums">
              <span>
                Created {formatShortDate(note.createdAt)} · {wordCount} words · {characterCount} chars
              </span>
              <span className="flex items-center gap-1">
                {(saving || autoSaveStatus === "saving") && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {autoSaveStatus === "saved" && !saving && <Check className="h-2.5 w-2.5 text-success/65" />}
                {autoSaveText}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {!isProtectedQuickNote && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete note"
          description="This note will be permanently deleted."
          onConfirm={handleDelete}
          variant="destructive"
        />
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent showCloseButton={false} className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b border-border/30">
            <DialogTitle className="text-sm font-semibold">Version history</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto p-3 space-y-1.5">
            {versions.length === 0 ? (
              <EmptyState
                variant="inline"
                description="No previous versions."
                className="py-4"
              />
            ) : (
              versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-md bg-card/40 border border-border/40 p-3 hover:bg-accent transition-smooth">
                  <span className="caption-text-sm tabular-nums">v{v.versionNumber} &middot; {formatNoteDate(v.createdAt)}</span>
                  <Button size="sm" variant="neutral" className="h-7 text-xs" onClick={() => handleRestoreVersion(v.id)}>
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="p-3 border-t border-border/30">
            <Button variant="neutral" size="sm" className="w-full h-8" onClick={() => setHistoryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface MetaSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}

function MetaSelect({ label, value, onChange, children }: MetaSelectProps) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
