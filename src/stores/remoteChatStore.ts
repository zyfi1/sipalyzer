import { create } from "zustand";
import {
  remoteChatGetState,
  remoteChatMarkRead,
  remoteChatOpenWindow,
  remoteChatSend,
  type RemoteChatMessage as ApiRemoteChatMessage,
  type RemoteChatState,
} from "@/api/remoteAgent";

export interface RemoteChatMessage {
  id: string;
  agentId: string;
  sender: string;
  text: string;
  timestamp: string;
  unread: boolean;
}

interface RemoteChatStoreState {
  messages: RemoteChatMessage[];
  unreadTotal: number;
  unreadByAgent: Record<string, number>;
  lastSender: string | null;
  lastSnippet: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyServerState: (state: RemoteChatState) => void;
  appendMessage: (message: ApiRemoteChatMessage) => void;
  sendMessage: (agentId: string, text: string) => Promise<void>;
  markRead: (agentId?: string) => Promise<void>;
  openRemoteChatWindow: () => Promise<void>;
}

function mapMessage(msg: ApiRemoteChatMessage): RemoteChatMessage {
  return {
    id: msg.id,
    agentId: msg.agent_id,
    sender: msg.sender,
    text: msg.text,
    timestamp: msg.timestamp,
    unread: msg.unread,
  };
}

export const useRemoteChatStore = create<RemoteChatStoreState>((set, get) => ({
  messages: [],
  unreadTotal: 0,
  unreadByAgent: {},
  lastSender: null,
  lastSnippet: null,
  hydrated: false,

  hydrate: async () => {
    const state = await remoteChatGetState();
    get().applyServerState(state);
    set({ hydrated: true });
  },

  applyServerState: (state) => {
    set({
      messages: state.messages.map(mapMessage),
      unreadTotal: state.unread_total,
      unreadByAgent: state.unread_by_agent ?? {},
      lastSender: state.last_sender ?? null,
      lastSnippet: state.last_snippet ?? null,
    });
  },

  appendMessage: (message) => {
    set((s) => ({
      messages: [...s.messages, mapMessage(message)].slice(-1000),
    }));
  },

  sendMessage: async (agentId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await remoteChatSend(agentId, trimmed);
  },

  markRead: async (agentId) => {
    await remoteChatMarkRead(agentId);
  },

  openRemoteChatWindow: async () => {
    await remoteChatOpenWindow();
  },
}));

