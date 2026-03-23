import { useState, useEffect, useMemo } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { X, Star, ChevronRight, ChevronLeft, Sparkles, Save } from "@/lib/icons";
import { TipTapEditor } from "./editor/TipTapEditor";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

interface NoteEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteId?: string;
  linkedRegistrarId?: string;
  folderId?: string;
  templateId?: string;
}

export function NoteEditorModal({
  isOpen,
  onClose,
  noteId,
  linkedRegistrarId: initialLinkedRegistrarId,
  folderId: initialFolderId,
  templateId: initialTemplateId,
}: NoteEditorModalProps) {
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const getNote = useNoteStore((s) => s.getNote);
  const loading = useNoteStore((s) => s.loading);
  const allTags = useNoteStore((s) => s.allTags);
  const getAllTags = useNoteStore((s) => s.getAllTags);
  const folders = useNoteStore((s) => s.folders);
  const templates = useNoteStore((s) => s.templates);
  const fetchFolders = useNoteStore((s) => s.fetchFolders);
  const fetchTemplates = useNoteStore((s) => s.fetchTemplates);
  const getAISuggestions = useNoteStore((s) => s.getAISuggestions);
  const registrars = useRegistrationStore((s) => s.registrars);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [linkedRegistrarId, setLinkedRegistrarId] = useState<string | undefined>(initialLinkedRegistrarId);
  const [linkedAgentId, setLinkedAgentId] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<string>("");
  const [isPinned, setIsPinned] = useState(false);
  const [folderId, setFolderId] = useState<string | undefined>(initialFolderId);
  const [templateId, setTemplateId] = useState<string | undefined>(initialTemplateId);
  const [, setShowPreview] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiSuggestions, setAISuggestions] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) { fetchFolders(); fetchTemplates(); getAllTags(); }
  }, [isOpen, fetchFolders, fetchTemplates, getAllTags]);

  useEffect(() => {
    if (!isOpen) {
      setTitle(""); setContent(""); setTags([]); setCategory(""); setIsPinned(false);
      setFolderId(initialFolderId); setTemplateId(initialTemplateId);
      setShowPreview(false); setShowSidebar(true); setError(null);
      return;
    }
    if (noteId) {
      getNote(noteId).then((note) => {
        if (note) {
          setTitle(note.title); setContent(note.content); setTags(note.tags);
          setLinkedRegistrarId(note.linkedRegistrarId); setLinkedAgentId(note.linkedAgentId);
          setCategory(note.category || ""); setIsPinned(note.isPinned || false);
          setFolderId(note.folderId); setTemplateId(note.templateId);
        }
      });
    } else if (initialTemplateId) {
      const template = templates.find((t) => t.id === initialTemplateId);
      if (template) {
        setTitle(template.titleTemplate); setContent(template.contentTemplate);
        setTags(template.tags || []); setCategory(template.category || "");
      }
    }
  }, [isOpen, noteId, initialTemplateId, initialFolderId, getNote, templates, fetchFolders, fetchTemplates]);

  useEffect(() => {
    if (noteId && showAISuggestions) getAISuggestions(noteId).then(setAISuggestions).catch(console.error);
  }, [noteId, showAISuggestions, getAISuggestions]);

  const handleSave = async () => {
    setError(null);
    try {
      if (noteId) {
        await updateNote(noteId, title, content, tags, category, isPinned, undefined, folderId, linkedRegistrarId, linkedAgentId);
      } else {
        await createNote(title, content, tags, linkedRegistrarId, linkedAgentId, category, isPinned, undefined, folderId, templateId);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    }
  };

  const notes = useNoteStore((s) => s.notes);
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    notes.forEach((note) => { if (note.category) cats.add(note.category); });
    return Array.from(cats).sort();
  }, [notes]);

  useKeyboardShortcuts({
    "ctrl+s": (e) => { if (!isOpen) return; e.preventDefault(); handleSave(); },
    "escape": (e) => { if (isOpen) { e.preventDefault(); onClose(); } },
    "ctrl+/": (e) => { if (!isOpen) return; e.preventDefault(); setShowAISuggestions(!showAISuggestions); },
  });

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-md border border-border/55 p-0"
      >
        {/* Header */}
        <div className="h-12 bg-card border-b border-border/55 flex items-center justify-between px-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <TooltipWrapper title="Close" description="Close without saving (Esc).">
              <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-8 text-[15px] font-semibold flex-1"
            />
            <div className="flex items-center gap-1">
              <TooltipWrapper title={isPinned ? "Unpin" : "Pin"}>
                <Button variant="ghost" size="sm" onClick={() => setIsPinned(!isPinned)} className={cn("h-7 w-7 p-0", isPinned && "text-warning")}>
                  <Star className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
                </Button>
              </TooltipWrapper>
              {templates.length > 0 && (
                <AppDropdown
                  value={templateId || "__none__"}
                  onValueChange={(v) => setTemplateId(v === "__none__" ? undefined : v)}
                  placeholder="Template"
                  className="h-7 w-[120px] text-2xs"
                  options={[
                    { value: "__none__", label: "No Template" },
                    ...templates.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              )}
              <TooltipWrapper title="AI suggestions" description="Get tag/category suggestions (Ctrl+/).">
                <Button variant="ghost" size="sm" onClick={() => setShowAISuggestions(!showAISuggestions)} className={cn("h-7 gap-1 text-2xs", showAISuggestions && "bg-accent")}>
                  <Sparkles className="h-3 w-3" />
                  AI
                </Button>
              </TooltipWrapper>
              <TooltipWrapper title={showSidebar ? "Hide sidebar" : "Show sidebar"}>
                <Button variant="ghost" size="sm" onClick={() => setShowSidebar(!showSidebar)} className="h-7 w-7 p-0">
                  {showSidebar ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                </Button>
              </TooltipWrapper>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-3">
            <Button variant="neutral" size="sm" onClick={onClose} className="h-7 text-xs">Cancel</Button>
            <TooltipWrapper title={noteId ? "Save" : "Create"} description="Ctrl+S">
              <Button size="sm" onClick={handleSave} disabled={loading} className="h-7 text-xs gap-1">
                <Save className="h-3 w-3" />
                {loading ? "Saving..." : noteId ? "Save" : "Create"}
              </Button>
            </TooltipWrapper>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor */}
          <div className={cn("flex-1 flex flex-col overflow-hidden")}>
            <div className="flex-1 overflow-hidden">
              <TipTapEditor
                content={content}
                onChange={setContent}
                className="h-full"
                placeholder="Start writing your note..."
              />
            </div>
          </div>

          {/* Sidebar */}
          {showSidebar && (
            <div className="w-72 border-l border-border/55 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <SidebarSection label="Folder">
                  <AppDropdown
                    value={folderId || "__none__"}
                    onValueChange={(v) => setFolderId(v === "__none__" ? undefined : v)}
                    placeholder="No folder"
                    className="h-7 text-2xs"
                    options={[
                      { value: "__none__", label: "No folder" },
                      ...folders.map((f) => ({ value: f.id, label: f.name })),
                    ]}
                  />
                </SidebarSection>

              <SidebarSection label="Category">
                <AppDropdown
                  value={category || "__none__"}
                  onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
                  placeholder="No category"
                  className="h-7 text-2xs"
                  options={[
                    { value: "__none__", label: "No category" },
                    ...allCategories.map((cat) => ({ value: cat, label: cat })),
                  ]}
                />
              </SidebarSection>

              <SidebarSection label="Tags">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-2xs h-5 gap-1">
                      {tag}
                      <button onClick={() => setTags(tags.filter((t) => t !== tag))} className="hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <AppDropdown
                  value="__placeholder__"
                  onValueChange={(tag) => {
                    if (tag && tag !== "__placeholder__" && !tags.includes(tag)) setTags([...tags, tag]);
                  }}
                  placeholder="Add tag..."
                  className="h-7 text-2xs"
                  options={[
                    { value: "__placeholder__", label: "Add tag..." },
                    ...(allTags || [])
                      .filter((tag) => !tags.includes(tag))
                      .map((tag) => ({ value: tag, label: tag })),
                  ]}
                />
              </SidebarSection>

              <SidebarSection label="Linked Registrar">
                <AppDropdown
                  value={linkedRegistrarId || "__none__"}
                  onValueChange={(v) => setLinkedRegistrarId(v === "__none__" ? undefined : v)}
                  placeholder="None"
                  className="h-7 text-2xs"
                  options={[
                    { value: "__none__", label: "None" },
                    ...registrars.map((reg) => ({ value: reg.id!, label: reg.name })),
                  ]}
                />
              </SidebarSection>

              {/* AI Suggestions */}
              {showAISuggestions && aiSuggestions && (
                <div className="border-t border-border/55 pt-4">
                  <label className="section-label-sm mb-2 block">AI Suggestions</label>
                  {aiSuggestions.suggested_tags?.length > 0 && (
                    <div className="mb-3">
                      <div className="text-2xs text-muted-foreground mb-1.5">Suggested Tags</div>
                      <div className="flex flex-wrap gap-1.5">
                        {aiSuggestions.suggested_tags.map((tag: string) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-2xs h-5 cursor-pointer hover:bg-accent"
                            onClick={() => { if (!tags.includes(tag)) setTags([...tags, tag]); }}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiSuggestions.suggested_category && (
                    <div className="mb-3">
                      <div className="text-2xs text-muted-foreground mb-1.5">Suggested Category</div>
                      <Badge variant="secondary" className="text-2xs h-5 cursor-pointer hover:bg-accent" onClick={() => setCategory(aiSuggestions.suggested_category)}>
                        {aiSuggestions.suggested_category}
                      </Badge>
                    </div>
                  )}
                </div>
              )}

                {error && (
                  <div className="text-xs text-destructive border-t border-border/55 pt-4">{error}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="section-label-sm mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
