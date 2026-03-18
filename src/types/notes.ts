export interface Note {
  id: string;
  title: string;
  content: string; // Markdown
  tags: string[];
  linkedRegistrarId?: string;
  linkedAgentId?: string;
  category?: string;
  isPinned?: boolean; // Favorite/pinned note
  linkedNoteIds?: string[]; // Links to other notes
  folderId?: string; // Hierarchical folder
  version?: number; // Version number
  templateId?: string; // Template used to create this note
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId?: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  versionNumber: number;
  createdAt: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  titleTemplate: string;
  contentTemplate: string;
  category?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: {
    folderId?: string;
    tags?: string[];
    category?: string;
    linkedRegistrarId?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  createdAt: string;
}
