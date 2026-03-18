import { create } from "zustand";

export interface CapturedError {
  id: string;
  timestamp: string;
  message: string;
  source: string;
  stack?: string;
  count: number;
}

interface ErrorStoreState {
  errors: CapturedError[];
  capture: (message: string, source: string, stack?: string) => void;
  clear: () => void;
}

const MAX_ERRORS = 200;

export const useErrorStore = create<ErrorStoreState>()((set) => ({
  errors: [],

  capture: (message, source, stack) => {
    set((state) => {
      const existing = state.errors.find(
        (e) => e.message === message && e.source === source,
      );
      if (existing) {
        return {
          errors: state.errors.map((e) =>
            e.id === existing.id
              ? { ...e, count: e.count + 1, timestamp: new Date().toISOString() }
              : e,
          ),
        };
      }
      const entry: CapturedError = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        message,
        source,
        stack,
        count: 1,
      };
      return {
        errors: [entry, ...state.errors].slice(0, MAX_ERRORS),
      };
    });
  },

  clear: () => set({ errors: [] }),
}));
