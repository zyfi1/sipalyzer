import { useState, useEffect, useCallback } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, FileText, Trash2, Edit, Copy, X, Save, Tag } from "@/lib/icons";
import type { NoteTemplate } from "@/types/notes";

interface TemplateManagerProps {
  onNavigateToNote?: (noteId: string) => void;
}

interface TemplateFormState {
  name: string;
  titleTemplate: string;
  contentTemplate: string;
  category: string;
  tagsInput: string;
}

const EMPTY_FORM: TemplateFormState = {
  name: "",
  titleTemplate: "",
  contentTemplate: "",
  category: "",
  tagsInput: "",
};

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function TemplateManager({ onNavigateToNote }: TemplateManagerProps) {
  const templates = useNoteStore((s) => s.templates);
  const fetchTemplates = useNoteStore((s) => s.fetchTemplates);
  const createTemplate = useNoteStore((s) => s.createTemplate);
  const deleteTemplate = useNoteStore((s) => s.deleteTemplate);
  const createNote = useNoteStore((s) => s.createNote);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);

  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormVisible(false);
    setEditingId(null);
  }, []);

  const openNewForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormVisible(true);
  }, []);

  const openEditForm = useCallback((template: NoteTemplate) => {
    setForm({
      name: template.name,
      titleTemplate: template.titleTemplate,
      contentTemplate: template.contentTemplate,
      category: template.category ?? "",
      tagsInput: template.tags.join(", "),
    });
    setEditingId(template.id);
    setFormVisible(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const tags = parseTags(form.tagsInput);
      const category = form.category.trim() || undefined;

      if (editingId) {
        await deleteTemplate(editingId);
        await createTemplate(
          form.name.trim(),
          form.titleTemplate,
          form.contentTemplate,
          category,
          tags,
        );
      } else {
        await createTemplate(
          form.name.trim(),
          form.titleTemplate,
          form.contentTemplate,
          category,
          tags,
        );
      }
      await fetchTemplates();
      resetForm();
    } finally {
      setSaving(false);
    }
  }, [form, editingId, createTemplate, deleteTemplate, fetchTemplates, resetForm]);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    await deleteTemplate(deleteId);
    await fetchTemplates();
    setDeleteId(null);
  }, [deleteId, deleteTemplate, fetchTemplates]);

  const handleUseTemplate = useCallback(
    async (template: NoteTemplate) => {
      const id = await createNote(
        template.titleTemplate,
        template.contentTemplate,
        template.tags,
        undefined,
        undefined,
        template.category,
      );
      setSelectedNoteId(id);
      onNavigateToNote?.(id);
    },
    [createNote, setSelectedNoteId, onNavigateToNote],
  );

  const updateField = useCallback(
    <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const formTags = parseTags(form.tagsInput);

  return (
    <div className="surface flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Templates</h2>
          {templates.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {templates.length}
            </Badge>
          )}
        </div>
        {!formVisible && (
          <TooltipWrapper title="Create a new template">
            <Button
              variant="default"
              size="sm"
              className="h-8 px-3"
              onClick={openNewForm}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Template
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* Inline form */}
        {formVisible && (
          <div className="space-y-3.5 rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="flex items-center justify-between">
              <span className="section-label-sm">
                {editingId ? "Edit Template" : "New Template"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={resetForm}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Input
              placeholder="Template name *"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="h-8 text-sm"
            />
            <Input
              placeholder="Title template"
              value={form.titleTemplate}
              onChange={(e) => updateField("titleTemplate", e.target.value)}
              className="h-8 text-sm"
            />
            <Textarea
              placeholder="Content template (Markdown)"
              value={form.contentTemplate}
              onChange={(e) => updateField("contentTemplate", e.target.value)}
              className="min-h-24 text-sm"
            />
            <Input
              placeholder="Category (optional)"
              value={form.category}
              onChange={(e) => updateField("category", e.target.value)}
              className="h-8 text-sm"
            />
            <div className="space-y-1.5">
              <Input
                placeholder="Tags (comma-separated)"
                value={form.tagsInput}
                onChange={(e) => updateField("tagsInput", e.target.value)}
                className="h-8 text-sm"
              />
              {formTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formTags.map((tag) => (
                    <Badge key={tag} variant="outline" className="h-5 px-1.5 text-[10px]">
                      <Tag className="h-2.5 w-2.5 mr-0.5" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3"
                onClick={resetForm}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Template list */}
        {templates.length === 0 && !formVisible ? (
          <EmptyState
            variant="inline"
            icon={<FileText />}
            title="No templates yet"
            description="Create reusable templates to speed up note creation"
            action={
              <Button size="sm" className="h-8 px-3" onClick={openNewForm}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create Template
              </Button>
            }
          />
        ) : (
          templates.map((template) => (
            <div
              key={template.id}
              className="group rounded-xl border border-border/25 bg-background/40 p-4 transition-smooth"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium line-clamp-1">
                      {template.name}
                    </h3>
                    {template.category && (
                      <Badge
                        variant="outline"
                        className="h-5 border-border/30 bg-muted/50 px-1.5 text-[10px] text-muted-foreground"
                      >
                        {template.category}
                      </Badge>
                    )}
                  </div>

                  {template.titleTemplate && (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/50">Title:</span>{" "}
                      {template.titleTemplate}
                    </p>
                  )}
                  {template.contentTemplate && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/50">Content:</span>{" "}
                      {template.contentTemplate.slice(0, 120)}
                    </p>
                  )}

                  {template.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hover actions */}
                <div className="shrink-0 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                  <TooltipWrapper title="Use template">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleUseTemplate(template)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper title="Edit template">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditForm(template)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper title="Delete template">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(template.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete Template"
        description="Are you sure you want to delete this template? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
