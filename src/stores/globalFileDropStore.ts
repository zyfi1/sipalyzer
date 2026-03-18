import { create } from "zustand";

export interface DroppedFaxFile {
  name: string;
  dataUrl: string;
  base64: string;
}

interface GlobalFileDropState {
  pendingFaxFiles: DroppedFaxFile[];
  enqueueFaxFiles: (files: DroppedFaxFile[]) => void;
  consumeFaxFiles: () => DroppedFaxFile[];
}

export const useGlobalFileDropStore = create<GlobalFileDropState>((set, get) => ({
  pendingFaxFiles: [],
  enqueueFaxFiles: (files) =>
    set((s) => ({
      pendingFaxFiles: [...s.pendingFaxFiles, ...files],
    })),
  consumeFaxFiles: () => {
    const files = get().pendingFaxFiles;
    set({ pendingFaxFiles: [] });
    return files;
  },
}));

