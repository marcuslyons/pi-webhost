import { create } from "zustand";
import type {
  ChatMessage,
  ContextUsage,
  ExtensionNotification,
  ExtensionUIDialog,
  LiveSessionInfo,
  ModelInfo,
  SavedSessionInfo,
  SessionData,
  SessionStats,
  ThinkingLevel,
  ToolExecution,
} from "../lib/types";

function emptySessionData(): SessionData {
  return {
    messages: [],
    toolExecutions: new Map(),
    currentAssistantId: null,
  };
}

interface ChatStore {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Active session
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;

  // Per-session data (messages, tool executions, streaming cursor)
  sessionDataMap: Map<string, SessionData>;
  getSessionData: (sessionId: string) => SessionData;
  ensureSessionData: (sessionId: string) => SessionData;

  // Convenience: active session's messages (for components)
  getActiveMessages: () => ChatMessage[];

  // Message operations (scoped to a session)
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  updateMessage: (sessionId: string, msgId: string, update: Partial<ChatMessage>) => void;
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  setCurrentAssistantId: (sessionId: string, id: string | null) => void;

  // Tool executions (scoped to a session)
  setToolExecution: (sessionId: string, toolId: string, exec: ToolExecution) => void;

  // Remove all data for a session
  removeSessionData: (sessionId: string) => void;

  // Live sessions (alive in this tab)
  liveSessions: LiveSessionInfo[];
  setLiveSessions: (sessions: LiveSessionInfo[], activeId: string | null) => void;

  // Session-level state (model, thinking, path) — for the active session
  activeModel: ModelInfo | null;
  setActiveModel: (model: ModelInfo | null) => void;
  activeThinkingLevel: ThinkingLevel;
  setActiveThinkingLevel: (level: ThinkingLevel) => void;
  activeSessionPath: string | null;
  setActiveSessionPath: (path: string | null) => void;
  activeCwd: string | null;
  setActiveCwd: (cwd: string | null) => void;
  activeIsStreaming: boolean;
  setActiveIsStreaming: (streaming: boolean) => void;

  // Server info
  serverCwd: string | null;
  serverHome: string | null;
  setServerInfo: (cwd: string, home: string) => void;

  // Available models (global)
  models: ModelInfo[];
  setModels: (models: ModelInfo[]) => void;

  // Saved sessions from disk
  savedSessions: SavedSessionInfo[];
  setSavedSessions: (sessions: SavedSessionInfo[]) => void;
  savedSessionsLoading: boolean;
  setSavedSessionsLoading: (loading: boolean) => void;

  // Auth status
  authStatus: Record<string, { hasCredentials: boolean }>;
  setAuthStatus: (status: Record<string, { hasCredentials: boolean }>) => void;

  // Extension UI
  extensionDialogQueue: ExtensionUIDialog[];
  pushExtensionDialog: (dialog: ExtensionUIDialog) => void;
  shiftExtensionDialog: () => void;
  extensionNotifications: ExtensionNotification[];
  addExtensionNotification: (notification: ExtensionNotification) => void;
  removeExtensionNotification: (id: string) => void;

  // Per-session telemetry
  sessionStatsMap: Map<string, { stats: SessionStats; context: ContextUsage | null }>;
  setSessionStats: (sessionId: string, stats: SessionStats, context: ContextUsage | null) => void;
  getActiveStats: () => { stats: SessionStats; context: ContextUsage | null } | null;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Connection
  connected: false,
  setConnected: (connected) => set({ connected }),

  // Active session
  activeSessionId: null,
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),

  // Session data map
  sessionDataMap: new Map(),

  getSessionData: (sessionId) => {
    return get().sessionDataMap.get(sessionId) ?? emptySessionData();
  },

  ensureSessionData: (sessionId) => {
    const map = get().sessionDataMap;
    if (!map.has(sessionId)) {
      const next = new Map(map);
      next.set(sessionId, emptySessionData());
      set({ sessionDataMap: next });
      return next.get(sessionId)!;
    }
    return map.get(sessionId)!;
  },

  getActiveMessages: () => {
    const { activeSessionId, sessionDataMap } = get();
    if (!activeSessionId) return [];
    return sessionDataMap.get(activeSessionId)?.messages ?? [];
  },

  addMessage: (sessionId, msg) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      const data = map.get(sessionId) ?? emptySessionData();
      map.set(sessionId, { ...data, messages: [...data.messages, msg] });
      return { sessionDataMap: map };
    }),

  updateMessage: (sessionId, msgId, update) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      const data = map.get(sessionId);
      if (!data) return {};
      map.set(sessionId, {
        ...data,
        messages: data.messages.map((m) => (m.id === msgId ? { ...m, ...update } : m)),
      });
      return { sessionDataMap: map };
    }),

  setMessages: (sessionId, msgs) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      const data = map.get(sessionId) ?? emptySessionData();
      map.set(sessionId, { ...data, messages: msgs });
      return { sessionDataMap: map };
    }),

  setCurrentAssistantId: (sessionId, id) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      const data = map.get(sessionId) ?? emptySessionData();
      map.set(sessionId, { ...data, currentAssistantId: id });
      return { sessionDataMap: map };
    }),

  setToolExecution: (sessionId, toolId, exec) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      const data = map.get(sessionId) ?? emptySessionData();
      const tools = new Map(data.toolExecutions);
      tools.set(toolId, exec);
      map.set(sessionId, { ...data, toolExecutions: tools });
      return { sessionDataMap: map };
    }),

  removeSessionData: (sessionId) =>
    set((state) => {
      const map = new Map(state.sessionDataMap);
      map.delete(sessionId);
      return { sessionDataMap: map };
    }),

  // Live sessions
  liveSessions: [],
  setLiveSessions: (liveSessions, activeId) =>
    set({ liveSessions, activeSessionId: activeId }),

  // Active session state
  activeModel: null,
  setActiveModel: (activeModel) => set({ activeModel }),
  activeThinkingLevel: "off",
  setActiveThinkingLevel: (activeThinkingLevel) => set({ activeThinkingLevel }),
  activeSessionPath: null,
  setActiveSessionPath: (activeSessionPath) => set({ activeSessionPath }),
  activeCwd: null,
  setActiveCwd: (activeCwd) => set({ activeCwd }),
  activeIsStreaming: false,
  setActiveIsStreaming: (activeIsStreaming) => set({ activeIsStreaming }),

  // Server info
  serverCwd: null,
  serverHome: null,
  setServerInfo: (serverCwd, serverHome) => set({ serverCwd, serverHome }),

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

  // Extension UI
  extensionDialogQueue: [],
  pushExtensionDialog: (dialog) =>
    set((state) => ({
      extensionDialogQueue: [...state.extensionDialogQueue, dialog],
    })),
  shiftExtensionDialog: () =>
    set((state) => ({
      extensionDialogQueue: state.extensionDialogQueue.slice(1),
    })),
  extensionNotifications: [],
  addExtensionNotification: (notification) =>
    set((state) => ({
      extensionNotifications: [...state.extensionNotifications, notification],
    })),
  removeExtensionNotification: (id) =>
    set((state) => ({
      extensionNotifications: state.extensionNotifications.filter((n) => n.id !== id),
    })),

  // Per-session telemetry
  sessionStatsMap: new Map(),
  setSessionStats: (sessionId, stats, context) =>
    set((state) => {
      const map = new Map(state.sessionStatsMap);
      map.set(sessionId, { stats, context });
      return { sessionStatsMap: map };
    }),
  getActiveStats: () => {
    const { activeSessionId, sessionStatsMap } = get();
    if (!activeSessionId) return null;
    return sessionStatsMap.get(activeSessionId) ?? null;
  },
}));
