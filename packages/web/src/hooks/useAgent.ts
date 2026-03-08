import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import type { ExtensionUIRequest, ThinkingLevel } from "../lib/types";

let messageIdCounter = 0;
function nextId() {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

/**
 * Hook that manages the WebSocket connection to the pi-webhost server
 * and translates Pi events into chat store updates.
 *
 * Supports multiple concurrent sessions. Events are tagged with sessionId
 * and routed to the correct per-session data in the store.
 */
export function useAgent() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = useChatStore.getState;

  // ── localStorage session tracking ─────────────────────────────────

  const STORAGE_KEY = "pi-webhost-sessions";

  function saveSessionState() {
    const s = store();
    const data = {
      subscribedSessionIds: Array.from(s.sessionDataMap.keys()),
      activeSessionId: s.activeSessionId,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* localStorage full or unavailable */ }
  }

  function loadSessionState(): { subscribedSessionIds: string[]; activeSessionId: string | null } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** On connect/reconnect, try to reattach to server sessions. */
  function attemptReattach() {
    // Ask the server what sessions exist
    send({ type: "list_active_sessions" });
  }

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      store().setConnected(true);
      fetchModels();
      fetchAuthStatus();
      fetchServerInfo();
      attemptReattach();
    };

    ws.onclose = () => {
      store().setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {};

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        handleServerMessage(data);
      } catch {
        // Ignore malformed messages
      }
    };
  }, []);

  // ── Server message routing ────────────────────────────────────────

  const handleServerMessage = useCallback((data: any) => {
    const s = store();

    if (data.type === "stats_update") {
      s.setSessionStats(data.sessionId, data.stats, data.context);
      return;
    }

    if (data.type === "session_created") {
      const sid = data.sessionId;
      s.ensureSessionData(sid);
      s.setActiveSessionId(sid);
      s.setActiveModel(data.model);
      s.setActiveSessionPath(data.sessionPath ?? null);
      s.setActiveCwd(data.cwd ?? null);
      s.setActiveIsStreaming(false);
      if (data.stats) {
        s.setSessionStats(sid, data.stats, data.context ?? null);
      }
      saveSessionState();
      return;
    }

    if (data.type === "session_switched") {
      const sid = data.sessionId;
      s.ensureSessionData(sid);
      s.setActiveSessionId(sid);
      s.setActiveModel(data.model);
      s.setActiveSessionPath(data.sessionPath ?? null);
      s.setActiveCwd(data.cwd ?? null);
      s.setActiveThinkingLevel(data.thinkingLevel ?? "off");
      s.setActiveIsStreaming(false);
      if (data.stats) {
        s.setSessionStats(sid, data.stats, data.context ?? null);
      }

      // Rebuild messages from loaded history
      if (data.messages?.length) {
        const msgs = buildMessagesFromHistory(data.messages);
        s.setMessages(sid, msgs);
      }
      saveSessionState();
      return;
    }

    if (data.type === "live_sessions_update") {
      s.setLiveSessions(data.sessions, data.activeSessionId);
      return;
    }

    if (data.type === "error") {
      // Show error in the relevant session (or active)
      const sid = data.sessionId ?? s.activeSessionId;
      if (sid) {
        s.addMessage(sid, {
          id: nextId(),
          role: "system",
          content: `Error: ${data.message}`,
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (data.type === "response") {
      if (data.command === "get_models" && data.success) {
        s.setModels(data.data.models);
      }
      if (data.command === "set_model" && data.success) {
        s.setActiveModel(data.data);
      }
      if (data.command === "list_persisted_sessions" && data.success) {
        s.setSavedSessions(data.data.sessions);
        s.setSavedSessionsLoading(false);
      }
      if (data.command === "set_active_session" && data.success) {
        const newActiveId = data.data.activeSessionId;
        s.setActiveSessionId(newActiveId);
        const live = s.liveSessions.find((ls) => ls.id === newActiveId);
        if (live) {
          s.setActiveModel(live.model);
          s.setActiveSessionPath(live.sessionPath);
          s.setActiveCwd(live.cwd);
          s.setActiveIsStreaming(live.isStreaming);
        }
      }
      if (data.command === "list_active_sessions" && data.success) {
        // Reattach to sessions that exist on both client and server
        const serverSessions: Array<{ id: string }> = data.data?.sessions ?? [];
        const serverIds = new Set(serverSessions.map((s: any) => s.id));
        const saved = loadSessionState();

        if (saved && saved.subscribedSessionIds.length > 0) {
          for (const sid of saved.subscribedSessionIds) {
            if (serverIds.has(sid)) {
              send({ type: "attach_session", sessionId: sid });
            }
          }
          // Restore active session if it still exists
          if (saved.activeSessionId && serverIds.has(saved.activeSessionId)) {
            // Will be set when attach_session response arrives
          }
        }
      }
      if (data.command === "close_session" && data.success) {
        s.removeSessionData(data.data?.closedSessionId);
        if (data.data?.activeSessionId) {
          s.setActiveSessionId(data.data.activeSessionId);
        }
        saveSessionState();
      }
      if (data.command === "rename_session" && data.success) {
        // Update the name in savedSessions locally
        const { sessionPath, name } = data.data;
        s.setSavedSessions(
          s.savedSessions.map((ss) =>
            ss.path === sessionPath ? { ...ss, name } : ss,
          ),
        );
      }
      if (data.command === "delete_session" && data.success) {
        // Remove from savedSessions locally
        const { sessionPath } = data.data;
        s.setSavedSessions(
          s.savedSessions.filter((ss) => ss.path !== sessionPath),
        );
      }
      return;
    }

    if (data.type === "extension_ui_request") {
      handleExtensionUIRequest(data as ExtensionUIRequest);
      return;
    }

    if (data.type === "event") {
      handlePiEvent(data.sessionId, data.event);
    }
  }, []);

  // ── Pi event handling (scoped to sessionId) ───────────────────────

  const handlePiEvent = useCallback((sessionId: string, event: any) => {
    if (!sessionId) return;
    const s = store();
    s.ensureSessionData(sessionId);
    const isActive = sessionId === s.activeSessionId;

    switch (event.type) {
      case "agent_start":
        if (isActive) s.setActiveIsStreaming(true);
        break;

      case "agent_end": {
        if (isActive) s.setActiveIsStreaming(false);
        const data = s.getSessionData(sessionId);
        if (data.currentAssistantId) {
          s.updateMessage(sessionId, data.currentAssistantId, { isStreaming: false });
          s.setCurrentAssistantId(sessionId, null);
        }
        break;
      }

      case "message_start": {
        const msg = event.message;
        if (msg?.role === "assistant") {
          const id = nextId();
          s.setCurrentAssistantId(sessionId, id);
          s.addMessage(sessionId, {
            id,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            model: msg.model,
            isStreaming: true,
          });
        }
        break;
      }

      case "message_update": {
        const delta = event.assistantMessageEvent;
        const data = s.getSessionData(sessionId);
        if (!delta || !data.currentAssistantId) break;

        if (delta.type === "text_delta") {
          const current = data.messages.find((m) => m.id === data.currentAssistantId);
          if (current) {
            s.updateMessage(sessionId, data.currentAssistantId, {
              content: current.content + delta.delta,
            });
          }
        } else if (delta.type === "thinking_delta") {
          const current = data.messages.find((m) => m.id === data.currentAssistantId);
          if (current) {
            s.updateMessage(sessionId, data.currentAssistantId, {
              thinkingContent: (current.thinkingContent ?? "") + delta.delta,
            });
          }
        }
        break;
      }

      case "message_end": {
        const data = s.getSessionData(sessionId);
        if (data.currentAssistantId) {
          const update: Partial<import("../lib/types").ChatMessage> = { isStreaming: false };
          // Extract per-message usage from the assistant message
          const msg = event.message;
          if (msg?.role === "assistant" && msg.usage) {
            update.usage = {
              input: msg.usage.input,
              output: msg.usage.output,
              cacheRead: msg.usage.cacheRead,
              cacheWrite: msg.usage.cacheWrite,
              totalTokens: msg.usage.totalTokens,
              cost: msg.usage.cost,
            };
          }
          s.updateMessage(sessionId, data.currentAssistantId, update);
        }
        break;
      }

      case "tool_execution_start": {
        s.setToolExecution(sessionId, event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
        });
        s.addMessage(sessionId, {
          id: `tool-${event.toolCallId}`,
          role: "tool_call",
          content: formatToolArgs(event.toolName, event.args),
          timestamp: Date.now(),
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolArgs: event.args,
        });
        break;
      }

      case "tool_execution_update": {
        const partial = event.partialResult?.content?.[0]?.text ?? "";
        s.setToolExecution(sessionId, event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
          partialResult: partial,
        });
        const data = s.getSessionData(sessionId);
        const exists = data.messages.find((m) => m.id === `toolresult-${event.toolCallId}`);
        if (exists) {
          s.updateMessage(sessionId, `toolresult-${event.toolCallId}`, { content: partial });
        } else if (partial) {
          s.addMessage(sessionId, {
            id: `toolresult-${event.toolCallId}`,
            role: "tool_result",
            content: partial,
            timestamp: Date.now(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
          });
        }
        break;
      }

      case "tool_execution_end": {
        const resultText = event.result?.content?.[0]?.text ?? "";
        s.setToolExecution(sessionId, event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: {},
          status: event.isError ? "error" : "complete",
          result: resultText,
          isError: event.isError,
        });
        const data = s.getSessionData(sessionId);
        const existingResult = data.messages.find((m) => m.id === `toolresult-${event.toolCallId}`);
        if (existingResult) {
          s.updateMessage(sessionId, `toolresult-${event.toolCallId}`, {
            content: resultText,
            isError: event.isError,
          });
        } else {
          s.addMessage(sessionId, {
            id: `toolresult-${event.toolCallId}`,
            role: "tool_result",
            content: resultText,
            timestamp: Date.now(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            isError: event.isError,
          });
        }
        break;
      }

      case "auto_compaction_start":
        s.addMessage(sessionId, {
          id: nextId(),
          role: "system",
          content: `Compacting context (${event.reason})...`,
          timestamp: Date.now(),
        });
        break;

      case "auto_compaction_end":
        if (event.result) {
          s.addMessage(sessionId, {
            id: nextId(),
            role: "system",
            content: `Context compacted. Tokens before: ${event.result.tokensBefore}`,
            timestamp: Date.now(),
          });
        }
        break;
    }
  }, []);

  // ── Extension UI request handling ─────────────────────────────────

  const handleExtensionUIRequest = useCallback((req: ExtensionUIRequest) => {
    const s = store();

    switch (req.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        // Dialog methods — push to queue for the UI to render
        s.pushExtensionDialog(req);
        break;

      case "notify":
        s.addExtensionNotification({
          id: req.id,
          message: req.message,
          notifyType: req.notifyType ?? "info",
          timestamp: Date.now(),
        });
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
          store().removeExtensionNotification(req.id);
        }, 5000);
        break;

      // Fire-and-forget methods we can handle or ignore
      case "setStatus":
      case "setWidget":
      case "setTitle":
      case "set_editor_text":
        // These could be implemented later; for now, ignore
        break;
    }
  }, []);

  // ── Send command to server ────────────────────────────────────────

  const send = useCallback((cmd: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────

  const sendPrompt = useCallback(
    (message: string, images?: Array<{ data: string; mimeType: string }>) => {
      const s = store();
      const sid = s.activeSessionId;

      // Add user message to the active session (or it'll be created)
      if (sid) {
        s.addMessage(sid, {
          id: nextId(),
          role: "user",
          content: message,
          timestamp: Date.now(),
        });
      }

      if (s.activeIsStreaming) {
        send({ type: "follow_up", message, sessionId: sid });
      } else {
        // If no active session, prompt will auto-create one on the server
        const promptCmd: any = { type: "prompt", message, sessionId: sid };
        if (images?.length) promptCmd.images = images;
        send(promptCmd);

        // If we didn't have a session, add user message after creation
        if (!sid) {
          // The message will be shown after session_created arrives
          // Store it temporarily
          const pendingMsg = {
            id: nextId(),
            role: "user" as const,
            content: message,
            timestamp: Date.now(),
          };
          // We'll add it when session_created fires via a small workaround:
          // Actually, the server sends session_created before the prompt response,
          // so let's just queue a microtask
          queueMicrotask(() => {
            const newSid = store().activeSessionId;
            if (newSid) {
              store().addMessage(newSid, pendingMsg);
            }
          });
        }
      }
    },
    [send],
  );

  const abort = useCallback((sessionId?: string) => {
    send({ type: "abort", sessionId: sessionId ?? store().activeSessionId });
  }, [send]);

  const setModel = useCallback(
    (provider: string, modelId: string) => {
      send({ type: "set_model", provider, modelId, sessionId: store().activeSessionId });
    },
    [send],
  );

  const setThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      send({ type: "set_thinking_level", level, sessionId: store().activeSessionId });
      store().setActiveThinkingLevel(level);
    },
    [send],
  );

  const newSession = useCallback(
    (cwd?: string) => {
      send({ type: "new_session", cwd });
    },
    [send],
  );

  const listSessions = useCallback(
    (cwd?: string) => {
      store().setSavedSessionsLoading(true);
      send({ type: "list_persisted_sessions", cwd });
    },
    [send],
  );

  const switchSession = useCallback(
    (sessionPath: string) => {
      send({ type: "switch_session", sessionPath });
    },
    [send],
  );

  const setActiveSession = useCallback(
    (sessionId: string) => {
      // Optimistically update the active session on the client
      const s = store();
      s.setActiveSessionId(sessionId);
      const live = s.liveSessions.find((ls) => ls.id === sessionId);
      if (live) {
        s.setActiveModel(live.model);
        s.setActiveSessionPath(live.sessionPath);
        s.setActiveCwd(live.cwd);
        s.setActiveIsStreaming(live.isStreaming);
      }
      send({ type: "set_active_session", sessionId });
    },
    [send],
  );

  const closeSession = useCallback(
    (sessionId: string) => {
      store().removeSessionData(sessionId);
      send({ type: "close_session", sessionId });
    },
    [send],
  );

  const sendExtensionUIResponse = useCallback(
    (sessionId: string, requestId: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      send({ type: "extension_ui_response", sessionId, requestId, response });
      store().shiftExtensionDialog();
    },
    [send],
  );

  const renameSession = useCallback(
    (sessionPath: string, name: string) => {
      send({ type: "rename_session", sessionPath, name });
    },
    [send],
  );

  const deleteSession = useCallback(
    (sessionPath: string) => {
      send({ type: "delete_session", sessionPath });
    },
    [send],
  );

  const compact = useCallback(() => {
    const sid = store().activeSessionId;
    if (sid) {
      send({ type: "compact", sessionId: sid });
    }
  }, [send]);

  const fetchModels = useCallback(() => {
    send({ type: "get_models" });
  }, [send]);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      store().setAuthStatus(data.providers);
    } catch {
      // Ignore
    }
  }, []);

  const fetchServerInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/cwd");
      const data = await res.json();
      store().setServerInfo(data.cwd, data.home);
    } catch {
      // Ignore
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    sendPrompt,
    abort,
    compact,
    setModel,
    setThinkingLevel,
    newSession,
    listSessions,
    switchSession,
    setActiveSession,
    closeSession,
    renameSession,
    deleteSession,
    fetchModels,
    fetchAuthStatus,
    sendExtensionUIResponse,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildMessagesFromHistory(rawMessages: any[]): import("../lib/types").ChatMessage[] {
  const msgs: import("../lib/types").ChatMessage[] = [];
  for (const msg of rawMessages) {
    if (msg.role === "user") {
      msgs.push({
        id: nextId(),
        role: "user",
        content: msg.content,
        timestamp: msg.timestamp,
      });
    } else if (msg.role === "assistant") {
      msgs.push({
        id: nextId(),
        role: "assistant",
        content: msg.content,
        timestamp: msg.timestamp,
        model: msg.model,
        thinkingContent: msg.thinkingContent,
        isStreaming: false,
      });
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          msgs.push({
            id: `tool-${tc.id}`,
            role: "tool_call",
            content: formatToolArgs(tc.name, tc.arguments ?? {}),
            timestamp: msg.timestamp,
            toolName: tc.name,
            toolCallId: tc.id,
            toolArgs: tc.arguments ?? undefined,
          });
        }
      }
    } else if (msg.role === "tool_result") {
      msgs.push({
        id: `toolresult-${msg.toolCallId ?? nextId()}`,
        role: "tool_result",
        content: msg.content,
        timestamp: msg.timestamp,
        toolName: msg.toolName,
        toolCallId: msg.toolCallId,
        isError: msg.isError,
      });
    } else if (msg.role === "system") {
      msgs.push({
        id: nextId(),
        role: "system",
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }
  }
  return msgs;
}

function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash":
      return `\`${args.command}\``;
    case "read":
      return `Reading \`${args.path}\`${args.offset ? ` (lines ${args.offset}-${(args.offset as number) + ((args.limit as number) ?? 0)})` : ""}`;
    case "write":
      return `Writing \`${args.path}\``;
    case "edit":
      return `Editing \`${args.path}\``;
    case "grep":
      return `grep ${args.pattern} ${args.path ?? "."}`;
    case "find":
      return `find ${args.path ?? "."} ${args.pattern ? `-name "${args.pattern}"` : ""}`;
    case "ls":
      return `ls ${args.path ?? "."}`;
    default:
      return `${toolName}(${JSON.stringify(args).slice(0, 200)})`;
  }
}
