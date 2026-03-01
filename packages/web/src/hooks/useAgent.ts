import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import type { ThinkingLevel } from "../lib/types";

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
      if (data.command === "close_session" && data.success) {
        s.removeSessionData(data.data?.closedSessionId);
        if (data.data?.activeSessionId) {
          s.setActiveSessionId(data.data.activeSessionId);
        }
      }
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
          s.updateMessage(sessionId, data.currentAssistantId, { isStreaming: false });
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

  // ── Send command to server ────────────────────────────────────────

  const send = useCallback((cmd: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────

  const sendPrompt = useCallback(
    (message: string) => {
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
        send({ type: "prompt", message, sessionId: sid });

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
    setModel,
    setThinkingLevel,
    newSession,
    listSessions,
    switchSession,
    setActiveSession,
    closeSession,
    fetchModels,
    fetchAuthStatus,
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
