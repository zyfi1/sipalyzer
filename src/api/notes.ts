/**
 * Notes API — typed wrappers for note backend commands.
 */

import { invokeTauri } from "./invoke";
import type { Note } from "@/types/notes";
import type { NoteFolder, NoteTemplate, NoteVersion } from "@/types/notes";

export async function searchNotes(query: string): Promise<Note[]> {
  return invokeTauri<Note[]>("search_notes", { query });
}

export interface NoteWriteInput {
  title: string;
  content: string;
  tags: string[];
  category?: string;
  isPinned?: boolean;
  linkedNoteIds?: string[];
  folderId?: string;
  linkedRegistrarId?: string;
  linkedAgentId?: string;
}

export interface CreateNoteInput extends NoteWriteInput {
  templateId?: string;
}

export interface FetchNotesFilters {
  linkedRegistrarId?: string;
  tags?: string[];
}

export interface SearchNotesAdvancedInput {
  query: string;
  folderId?: string;
  tags?: string[];
  category?: string;
  linkedRegistrarId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateTemplateInput {
  name: string;
  titleTemplate: string;
  contentTemplate: string;
  category?: string;
  tags?: string[];
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string;
}

function toNoteWritePayload(input: NoteWriteInput): Record<string, unknown> {
  return {
    title: input.title,
    content: input.content,
    tags: input.tags,
    category: input.category ?? null,
    isPinned: input.isPinned ?? false,
    linkedNoteIds: input.linkedNoteIds ?? null,
    folderId: input.folderId ?? null,
    linkedRegistrarId: input.linkedRegistrarId ?? null,
    linkedAgentId: input.linkedAgentId ?? null,
  };
}

export async function getNotes(filters?: FetchNotesFilters): Promise<Note[]> {
  return invokeTauri<Note[]>("get_notes", {
    linkedRegistrarId: filters?.linkedRegistrarId ?? null,
    tags: filters?.tags ?? null,
  });
}

export async function getAllNotes(): Promise<Note[]> {
  return invokeTauri<Note[]>("get_all_notes");
}

export async function createNote(input: CreateNoteInput): Promise<string> {
  return invokeTauri<string>("create_note", {
    ...toNoteWritePayload(input),
    templateId: input.templateId ?? null,
  });
}

export async function updateNote(id: string, input: NoteWriteInput): Promise<void> {
  return invokeTauri<void>("update_note", {
    id,
    ...toNoteWritePayload(input),
  });
}

export async function deleteNote(id: string): Promise<void> {
  return invokeTauri<void>("delete_note", { id });
}

export async function getNote(id: string): Promise<Note> {
  return invokeTauri<Note>("get_note", { id });
}

export async function getAllTags(): Promise<string[]> {
  return invokeTauri<string[]>("get_all_tags");
}

export async function getAllCategories(): Promise<string[]> {
  return invokeTauri<string[]>("get_all_categories");
}

export async function getNoteFolders(): Promise<NoteFolder[]> {
  return invokeTauri<NoteFolder[]>("get_note_folders");
}

export async function createNoteFolder(name: string, parentId?: string): Promise<string> {
  return invokeTauri<string>("create_note_folder", {
    name,
    parentId: parentId ?? null,
  });
}

export async function updateNoteFolder(id: string, input: UpdateFolderInput): Promise<void> {
  return invokeTauri<void>("update_note_folder", {
    id,
    name: input.name ?? null,
    parentId: input.parentId ?? null,
  });
}

export async function deleteNoteFolder(id: string): Promise<void> {
  return invokeTauri<void>("delete_note_folder", { id });
}

export async function getNoteTemplates(): Promise<NoteTemplate[]> {
  return invokeTauri<NoteTemplate[]>("get_note_templates");
}

export async function createNoteTemplate(input: CreateTemplateInput): Promise<string> {
  return invokeTauri<string>("create_note_template", {
    name: input.name,
    titleTemplate: input.titleTemplate,
    contentTemplate: input.contentTemplate,
    category: input.category ?? null,
    tags: input.tags ?? [],
  });
}

export async function deleteNoteTemplate(id: string): Promise<void> {
  return invokeTauri<void>("delete_note_template", { id });
}

export async function getNoteVersions(noteId: string): Promise<NoteVersion[]> {
  return invokeTauri<NoteVersion[]>("get_note_versions", { noteId });
}

export async function getNoteVersion(versionId: string): Promise<NoteVersion> {
  return invokeTauri<NoteVersion>("get_note_version", { versionId });
}

export async function restoreNoteVersion(versionId: string): Promise<void> {
  return invokeTauri<void>("restore_note_version", { versionId });
}

export async function searchNotesAdvanced(input: SearchNotesAdvancedInput): Promise<Note[]> {
  return invokeTauri<Note[]>("search_notes_advanced", {
    query: input.query,
    folderId: input.folderId ?? null,
    tags: input.tags ?? null,
    category: input.category ?? null,
    linkedRegistrarId: input.linkedRegistrarId ?? null,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
  });
}

export async function getNoteAISuggestions(noteId: string): Promise<unknown> {
  return invokeTauri<unknown>("get_note_ai_suggestions", { noteId });
}

export async function getDeletedNotes(): Promise<Note[]> {
  return invokeTauri<Note[]>("get_deleted_notes");
}

export async function restoreNote(id: string): Promise<void> {
  return invokeTauri<void>("restore_note", { id });
}

export async function permanentlyDeleteNote(id: string): Promise<void> {
  return invokeTauri<void>("permanently_delete_note", { id });
}

export async function emptyTrash(): Promise<void> {
  return invokeTauri<void>("empty_trash");
}
