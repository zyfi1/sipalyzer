import { create } from "zustand";
import type { Note, NoteFolder, NoteVersion, NoteTemplate, SavedSearch } from "@/types/notes";
import {
  createNote as createNoteApi,
  createNoteFolder,
  createNoteTemplate,
  deleteNote as deleteNoteApi,
  deleteNoteFolder,
  deleteNoteTemplate,
  emptyTrash as emptyTrashApi,
  getAllCategories as getAllCategoriesApi,
  getAllNotes as getAllNotesApi,
  getAllTags as getAllTagsApi,
  getDeletedNotes,
  getNote as getNoteApi,
  getNoteAISuggestions,
  getNoteFolders,
  getNoteTemplates,
  getNoteVersion,
  getNoteVersions,
  getNotes,
  permanentlyDeleteNote as permanentlyDeleteNoteApi,
  restoreNote as restoreNoteApi,
  restoreNoteVersion,
  searchNotes as searchNotesApi,
  searchNotesAdvanced as searchNotesAdvancedApi,
  updateNote as updateNoteApi,
  updateNoteFolder,
} from "@/api/notes";

const HOME_QUICK_NOTE_TITLE = "Home Quick Note";
const HOME_QUICK_NOTE_PROTECTED_TAG = "home-quick-note-protected";

function isProtectedHomeQuickNote(note: Pick<Note, "title" | "tags"> | null | undefined): boolean {
  if (!note) return false;
  if (note.tags?.includes(HOME_QUICK_NOTE_PROTECTED_TAG)) return true;
  return note.title === HOME_QUICK_NOTE_TITLE;
}

interface DraftState {
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  linkedRegistrarId?: string;
  savedAt: number;
}

interface NoteState {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  selectedTags: string[];
  loading: boolean;
  error: string | null;
  allTags: string[];
  folders: NoteFolder[];
  templates: NoteTemplate[];
  versions: Record<string, NoteVersion[]>; // noteId -> versions
  savedSearches: SavedSearch[];
  deletedNotes: Note[];
  draft: DraftState | null;
  autoSaveEnabled: boolean;
  
  // Actions
  fetchNotes: (linkedRegistrarId?: string, tags?: string[]) => Promise<void>;
  fetchAllNotes: () => Promise<void>;
  createNote: (title: string, content: string, tags: string[], linkedRegistrarId?: string, linkedAgentId?: string, category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, templateId?: string) => Promise<string>;
  updateNote: (id: string, title: string, content: string, tags: string[], category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, linkedRegistrarId?: string, linkedAgentId?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  getNote: (id: string) => Promise<Note | null>;
  searchNotes: (query: string) => Promise<void>;
  searchNotesAdvanced: (query: string, folderId?: string, tags?: string[], category?: string, linkedRegistrarId?: string, dateFrom?: string, dateTo?: string) => Promise<Note[]>;
  getAllTags: () => Promise<void>;
  getAllCategories: () => Promise<string[]>;
  setSelectedNoteId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSelectedTags: (tags: string[]) => void;
  clearFilters: () => void;
  clearError: () => void;
  // Folder actions
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<string>;
  updateFolder: (id: string, name?: string, parentId?: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  // Template actions
  fetchTemplates: () => Promise<void>;
  createTemplate: (name: string, titleTemplate: string, contentTemplate: string, category?: string, tags?: string[]) => Promise<string>;
  deleteTemplate: (id: string) => Promise<void>;
  // Version actions
  fetchVersions: (noteId: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  // AI actions
  getAISuggestions: (noteId: string) => Promise<any>;
  // New actions for drag-drop and bulk operations
  moveNoteToFolder: (noteId: string, folderId: string | null) => Promise<void>;
  addTagToNote: (noteId: string, tag: string) => Promise<void>;
  removeTagFromNote: (noteId: string, tag: string) => Promise<void>;
  bulkMoveToFolder: (noteIds: string[], folderId: string | null) => Promise<void>;
  bulkAddTag: (noteIds: string[], tag: string) => Promise<void>;
  bulkDelete: (noteIds: string[]) => Promise<void>;
  togglePin: (noteId: string) => Promise<void>;
  // Trash actions
  fetchDeletedNotes: () => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  permanentlyDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  // Lightweight save for auto-save — updates backend + local state without full refresh
  updateNoteQuiet: (id: string, title: string, content: string, tags: string[], category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, linkedRegistrarId?: string, linkedAgentId?: string) => Promise<void>;
  // Draft/auto-save actions
  saveDraft: (noteId: string, title: string, content: string, tags: string[], linkedRegistrarId?: string) => void;
  clearDraft: () => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  selectedNoteId: null,
  searchQuery: "",
  selectedTags: [],
  loading: false,
  error: null,
  allTags: [],
  folders: [],
  templates: [],
  versions: {},
  savedSearches: [],
  deletedNotes: [],
  draft: null,
  autoSaveEnabled: true,

  fetchNotes: async (linkedRegistrarId?: string, tags?: string[]) => {
    set({ loading: true, error: null });
    try {
      const notes = await getNotes({ linkedRegistrarId, tags });
      set({ notes, loading: false });
    } catch (error) {
      console.error("Failed to fetch notes:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch notes",
        loading: false,
      });
    }
  },

  fetchAllNotes: async () => {
    set({ loading: true, error: null });
    try {
      const notes = await getAllNotesApi();
      set({ notes, loading: false });
    } catch (error) {
      console.error("Failed to fetch all notes:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch notes",
        loading: false,
      });
    }
  },

  createNote: async (title: string, content: string, tags: string[], linkedRegistrarId?: string, linkedAgentId?: string, category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, templateId?: string) => {
    set({ loading: true, error: null });
    try {
      const noteId = await createNoteApi({
        title,
        content,
        tags,
        linkedRegistrarId,
        linkedAgentId,
        category,
        isPinned,
        linkedNoteIds,
        folderId,
        templateId,
      });
      // Refresh notes
      await get().fetchAllNotes();
      await get().getAllTags();
      set({ loading: false });
      return noteId;
    } catch (error) {
      console.error("Failed to create note:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to create note",
        loading: false,
      });
      throw error;
    }
  },

  updateNote: async (id: string, title: string, content: string, tags: string[], category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, linkedRegistrarId?: string, linkedAgentId?: string) => {
    set({ error: null });
    try {
      await updateNoteApi(id, {
        title,
        content,
        tags,
        category,
        isPinned,
        linkedNoteIds,
        folderId,
        linkedRegistrarId,
        linkedAgentId,
      });
      const now = new Date().toISOString();
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title,
                content,
                tags,
                category,
                isPinned,
                linkedNoteIds,
                folderId,
                linkedRegistrarId,
                linkedAgentId,
                updatedAt: now,
              }
            : n
        ),
      }));
    } catch (error) {
      console.error("Failed to update note:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to update note",
      });
      throw error;
    }
  },

  deleteNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const note = get().notes.find((n) => n.id === id);
      if (isProtectedHomeQuickNote(note)) {
        set({ loading: false, error: "Home Quick Note cannot be deleted." });
        return;
      }
      await deleteNoteApi(id);
      // Refresh notes
      await get().fetchAllNotes();
      await get().getAllTags();
      await get().fetchDeletedNotes();
      set({ loading: false, selectedNoteId: null });
    } catch (error) {
      console.error("Failed to delete note:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to delete note",
        loading: false,
      });
      throw error;
    }
  },

  getNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const note = await getNoteApi(id);
      set({ loading: false });
      return note;
    } catch (error) {
      console.error("Failed to get note:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to get note",
        loading: false,
      });
      return null;
    }
  },

  searchNotes: async (query: string) => {
    set({ loading: true, error: null, searchQuery: query });
    try {
      const notes = await searchNotesApi(query);
      set({ notes, loading: false });
    } catch (error) {
      console.error("Failed to search notes:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to search notes",
        loading: false,
      });
    }
  },

  getAllTags: async () => {
    try {
      const tags = await getAllTagsApi();
      set({ allTags: tags });
    } catch (error) {
      console.error("Failed to get tags:", error);
    }
  },

  getAllCategories: async () => {
    try {
      const categories = await getAllCategoriesApi();
      return categories;
    } catch (error) {
      console.error("Failed to get categories:", error);
      return [];
    }
  },

  setSelectedNoteId: (id: string | null) => {
    set({ selectedNoteId: id });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setSelectedTags: (tags: string[]) => {
    set({ selectedTags: tags });
  },

  clearFilters: () => {
    set({ searchQuery: "", selectedTags: [] });
  },
  clearError: () => {
    set({ error: null });
  },
  // Folder actions
  fetchFolders: async () => {
    try {
      const folders = await getNoteFolders();
      set({ folders });
    } catch (error) {
      console.error("Failed to fetch folders:", error);
    }
  },
  createFolder: async (name: string, parentId?: string) => {
    try {
      const folderId = await createNoteFolder(name, parentId);
      await get().fetchFolders();
      return folderId;
    } catch (error) {
      console.error("Failed to create folder:", error);
      throw error;
    }
  },
  updateFolder: async (id: string, name?: string, parentId?: string) => {
    try {
      await updateNoteFolder(id, { name, parentId });
      await get().fetchFolders();
    } catch (error) {
      console.error("Failed to update folder:", error);
      throw error;
    }
  },
  deleteFolder: async (id: string) => {
    try {
      await deleteNoteFolder(id);
      await get().fetchFolders();
      await get().fetchAllNotes();
    } catch (error) {
      console.error("Failed to delete folder:", error);
      throw error;
    }
  },
  // Template actions
  fetchTemplates: async () => {
    try {
      const templates = await getNoteTemplates();
      set({ templates });
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    }
  },
  createTemplate: async (name: string, titleTemplate: string, contentTemplate: string, category?: string, tags?: string[]) => {
    try {
      const templateId = await createNoteTemplate({
        name,
        titleTemplate,
        contentTemplate,
        category,
        tags,
      });
      await get().fetchTemplates();
      return templateId;
    } catch (error) {
      console.error("Failed to create template:", error);
      throw error;
    }
  },
  deleteTemplate: async (id: string) => {
    try {
      await deleteNoteTemplate(id);
      await get().fetchTemplates();
    } catch (error) {
      console.error("Failed to delete template:", error);
      throw error;
    }
  },
  // Version actions
  fetchVersions: async (noteId: string) => {
    try {
      const versions = await getNoteVersions(noteId);
      set((state) => ({
        versions: { ...state.versions, [noteId]: versions },
      }));
    } catch (error) {
      console.error("Failed to fetch versions:", error);
    }
  },
  restoreVersion: async (versionId: string) => {
    try {
      const version = await getNoteVersion(versionId);
      await restoreNoteVersion(versionId);
      await get().fetchAllNotes();
      // Refresh versions for the restored note
      await get().fetchVersions(version.noteId);
    } catch (error) {
      console.error("Failed to restore version:", error);
      throw error;
    }
  },
  // Advanced search
  searchNotesAdvanced: async (query: string, folderId?: string, tags?: string[], category?: string, linkedRegistrarId?: string, dateFrom?: string, dateTo?: string) => {
    set({ loading: true, error: null });
    try {
      const notes = await searchNotesAdvancedApi({
        query,
        folderId,
        tags,
        category,
        linkedRegistrarId,
        dateFrom,
        dateTo,
      });
      set({ notes, loading: false });
      return notes;
    } catch (error) {
      console.error("Failed to search notes:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to search notes",
        loading: false,
      });
      throw error;
    }
  },
  // AI actions
  getAISuggestions: async (noteId: string) => {
    try {
      const suggestions = await getNoteAISuggestions(noteId);
      return suggestions;
    } catch (error) {
      console.error("Failed to get AI suggestions:", error);
      throw error;
    }
  },

  // New actions for drag-drop operations
  moveNoteToFolder: async (noteId: string, folderId: string | null) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;
    try {
      await updateNoteApi(note.id, {
        title: note.title,
        content: note.content,
        tags: note.tags,
        category: note.category,
        isPinned: note.isPinned,
        linkedNoteIds: note.linkedNoteIds,
        folderId: folderId ?? undefined,
        linkedRegistrarId: note.linkedRegistrarId,
        linkedAgentId: note.linkedAgentId,
      });
      await get().fetchAllNotes();
    } catch (error) {
      console.error("Failed to move note:", error);
      set({ error: error instanceof Error ? error.message : "Failed to move note" });
    }
  },

  addTagToNote: async (noteId: string, tag: string) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note || note.tags?.includes(tag)) return;
    try {
      const newTags = [...(note.tags || []), tag];
      await updateNoteApi(note.id, {
        title: note.title,
        content: note.content,
        tags: newTags,
        category: note.category,
        isPinned: note.isPinned,
        linkedNoteIds: note.linkedNoteIds,
        folderId: note.folderId,
        linkedRegistrarId: note.linkedRegistrarId,
        linkedAgentId: note.linkedAgentId,
      });
      await get().fetchAllNotes();
      await get().getAllTags();
    } catch (error) {
      console.error("Failed to add tag:", error);
      set({ error: error instanceof Error ? error.message : "Failed to add tag" });
    }
  },

  removeTagFromNote: async (noteId: string, tag: string) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;
    try {
      const newTags = (note.tags || []).filter((t) => t !== tag);
      await updateNoteApi(note.id, {
        title: note.title,
        content: note.content,
        tags: newTags,
        category: note.category,
        isPinned: note.isPinned,
        linkedNoteIds: note.linkedNoteIds,
        folderId: note.folderId,
        linkedRegistrarId: note.linkedRegistrarId,
        linkedAgentId: note.linkedAgentId,
      });
      await get().fetchAllNotes();
      await get().getAllTags();
    } catch (error) {
      console.error("Failed to remove tag:", error);
      set({ error: error instanceof Error ? error.message : "Failed to remove tag" });
    }
  },

  bulkMoveToFolder: async (noteIds: string[], folderId: string | null) => {
    set({ loading: true });
    try {
      for (const noteId of noteIds) {
        const note = get().notes.find((n) => n.id === noteId);
        if (!note) continue;
        await updateNoteApi(note.id, {
          title: note.title,
          content: note.content,
          tags: note.tags,
          category: note.category,
          isPinned: note.isPinned,
          linkedNoteIds: note.linkedNoteIds,
          folderId: folderId ?? undefined,
          linkedRegistrarId: note.linkedRegistrarId,
          linkedAgentId: note.linkedAgentId,
        });
      }
      await get().fetchAllNotes();
      set({ loading: false });
    } catch (error) {
      console.error("Failed to bulk move notes:", error);
      set({ error: error instanceof Error ? error.message : "Failed to move notes", loading: false });
    }
  },

  bulkAddTag: async (noteIds: string[], tag: string) => {
    set({ loading: true });
    try {
      for (const noteId of noteIds) {
        const note = get().notes.find((n) => n.id === noteId);
        if (!note || note.tags?.includes(tag)) continue;
        await updateNoteApi(note.id, {
          title: note.title,
          content: note.content,
          tags: [...(note.tags || []), tag],
          category: note.category,
          isPinned: note.isPinned,
          linkedNoteIds: note.linkedNoteIds,
          folderId: note.folderId,
          linkedRegistrarId: note.linkedRegistrarId,
          linkedAgentId: note.linkedAgentId,
        });
      }
      await get().fetchAllNotes();
      await get().getAllTags();
      set({ loading: false });
    } catch (error) {
      console.error("Failed to bulk add tag:", error);
      set({ error: error instanceof Error ? error.message : "Failed to add tags", loading: false });
    }
  },

  bulkDelete: async (noteIds: string[]) => {
    set({ loading: true });
    try {
      const protectedIds = new Set(
        get().notes
          .filter((n) => isProtectedHomeQuickNote(n))
          .map((n) => n.id),
      );
      for (const noteId of noteIds) {
        if (protectedIds.has(noteId)) continue;
        await deleteNoteApi(noteId);
      }
      await get().fetchAllNotes();
      await get().getAllTags();
      const { selectedNoteId } = get();
      if (selectedNoteId && noteIds.includes(selectedNoteId) && !protectedIds.has(selectedNoteId)) {
        set({ selectedNoteId: null });
      }
      set({ loading: false });
    } catch (error) {
      console.error("Failed to bulk delete notes:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to delete notes",
        loading: false,
      });
    }
  },

  fetchDeletedNotes: async () => {
    try {
      const deletedNotes = await getDeletedNotes();
      set({ deletedNotes });
    } catch (error) {
      console.error("Failed to fetch deleted notes:", error);
      set({ deletedNotes: [] });
    }
  },

  restoreNote: async (id: string) => {
    try {
      await restoreNoteApi(id);
      await get().fetchAllNotes();
      await get().fetchDeletedNotes();
      await get().getAllTags();
    } catch (error) {
      console.error("Failed to restore note:", error);
      set({ error: error instanceof Error ? error.message : "Failed to restore note" });
    }
  },

  permanentlyDeleteNote: async (id: string) => {
    try {
      const protectedDeleted = get().deletedNotes.find((n) => n.id === id);
      if (isProtectedHomeQuickNote(protectedDeleted)) {
        set({ error: "Home Quick Note cannot be permanently deleted." });
        return;
      }
      await permanentlyDeleteNoteApi(id);
      await get().fetchDeletedNotes();
    } catch (error) {
      console.error("Failed to permanently delete note:", error);
      set({ error: error instanceof Error ? error.message : "Failed to permanently delete note" });
    }
  },

  emptyTrash: async () => {
    try {
      const deleted = get().deletedNotes;
      const keep = deleted.filter((n) => isProtectedHomeQuickNote(n));
      const deleteNow = deleted.filter((n) => !isProtectedHomeQuickNote(n));
      if (keep.length === 0) {
        await emptyTrashApi();
        set({ deletedNotes: [] });
        return;
      }
      for (const note of deleteNow) {
        await permanentlyDeleteNoteApi(note.id);
      }
      set({ deletedNotes: keep });
    } catch (error) {
      console.error("Failed to empty trash:", error);
      set({ error: error instanceof Error ? error.message : "Failed to empty trash" });
    }
  },

  togglePin: async (noteId: string) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;
    try {
      await updateNoteApi(note.id, {
        title: note.title,
        content: note.content,
        tags: note.tags,
        category: note.category,
        isPinned: !note.isPinned,
        linkedNoteIds: note.linkedNoteIds,
        folderId: note.folderId,
        linkedRegistrarId: note.linkedRegistrarId,
        linkedAgentId: note.linkedAgentId,
      });
      await get().fetchAllNotes();
    } catch (error) {
      console.error("Failed to toggle pin:", error);
      set({ error: error instanceof Error ? error.message : "Failed to toggle pin" });
    }
  },

  // Lightweight save for auto-save — updates backend + patches local state
  // without triggering a full fetchAllNotes() cascade.
  updateNoteQuiet: async (id: string, title: string, content: string, tags: string[], category?: string, isPinned?: boolean, linkedNoteIds?: string[], folderId?: string, linkedRegistrarId?: string, linkedAgentId?: string) => {
    try {
      await updateNoteApi(id, {
        title,
        content,
        tags,
        category,
        isPinned,
        linkedNoteIds,
        folderId,
        linkedRegistrarId,
        linkedAgentId,
      });
      const now = new Date().toISOString();
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title,
                content,
                tags,
                category,
                isPinned,
                linkedNoteIds,
                folderId,
                linkedRegistrarId,
                linkedAgentId,
                updatedAt: now,
              }
            : n
        ),
      }));
    } catch (error) {
      console.error("Auto-save failed:", error);
      // Don't throw — auto-save failures are silent
    }
  },

  // Draft/auto-save actions
  saveDraft: (noteId: string, title: string, content: string, tags: string[], linkedRegistrarId?: string) => {
    set({
      draft: {
        noteId,
        title,
        content,
        tags,
        linkedRegistrarId,
        savedAt: Date.now(),
      },
    });
  },

  clearDraft: () => {
    set({ draft: null });
  },

  setAutoSaveEnabled: (enabled: boolean) => {
    set({ autoSaveEnabled: enabled });
  },
}));
