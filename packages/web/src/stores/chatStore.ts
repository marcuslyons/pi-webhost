import { create } from "zustand";
import type {
  ChatMessage,
  ModelInfo,
  SavedSessionInfo,
  SessionState,
  ThinkingLevel,
  ToolExecution,
} from "../lib/types";

interface ChatStore {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Session state
  session: SessionState;
  setSession: (session: Partial<SessionState>) => void;

  // Messages
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, update: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // Tool executions (tracked separately for UI)
  toolExecutions: Map<string, ToolExecution>;
  setToolExecution: (id: string, exec: ToolExecution) => void;
  clearToolExecutions: () => void;

  // Available models
  models: ModelInfo[];
  setModels: (models: ModelInfo[]) => void;

  // Saved sessions
  savedSessions: SavedSessionInfo[];
  setSavedSessions: (sessions: SavedSessionInfo[]) => void;
  savedSessionsLoading: boolean;
  setSavedSessionsLoading: (loading: boolean) => void;

  // Auth status
  authStatus: Record<string, { hasCredentials: boolean }>;
  setAuthStatus: (status: Record<string, { hasCredentials: boolean }>) => void;

  // UI state
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  // Connection
  connected: false,
  setConnected: (connected) => set({ connected }),

  // Session
  session: {
    sessionId: null,
    sessionPath: null,
    isStreaming: false,
    model: null,
    thinkingLevel: "off" as ThinkingLevel,
  },
  setSession: (partial) =>
    set((state) => ({ session: { ...state.session, ...partial } })),

  // Messages
  messages: [],
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  updateMessage: (id, update) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...update } : m,
      ),
    })),
  clearMessages: () => set({ messages: [] }),

  // Tool executions
  toolExecutions: new Map(),
  setToolExecution: (id, exec) =>
    set((state) => {
      const next = new Map(state.toolExecutions);
      next.set(id, exec);
      return { toolExecutions: next };
    }),
  clearToolExecutions: () => set({ toolExecutions: new Map() }),

  // Models
  models: [],
  setModels: (models) => set({ models }),

  // Saved sessions
  savedSessions: [],
  setSavedSessions: (savedSessions) => set({ savedSessions }),
  savedSessionsLoading: false,
  setSavedSessionsLoading: (savedSessionsLoading) => set({ savedSessionsLoading }),

  // Auth
  authStatus: {},
  setAuthStatus: (authStatus) => set({ authStatus }),

  // UI
  isSettingsOpen: false,
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
}));
