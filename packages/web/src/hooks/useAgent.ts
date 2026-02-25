import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import type { ChatMessage, ThinkingLevel } from "../lib/types";

let messageIdCounter = 0;
function nextId() {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

/**
 * Hook that manages the WebSocket connection to the pi-webhost server
 * and translates Pi events into chat store updates.
 */
export function useAgent() {
  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantId = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    setConnected,
    setSession,
    addMessage,
    updateMessage,
    setToolExecution,
    setModels,
    setAuthStatus,
    setSavedSessions,
    setSavedSessionsLoading,
  } = useChatStore.getState();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Fetch initial data
      fetchModels();
      fetchAuthStatus();
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after delay
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        handleServerMessage(data);
      } catch {
        // Ignore malformed messages
      }
    };
  }, []);

  const handleServerMessage = useCallback((data: any) => {
    const store = useChatStore.getState();

    if (data.type === "session_created") {
      setSession({
        sessionId: data.sessionId,
        sessionPath: data.sessionPath ?? null,
        model: data.model,
      });
      return;
    }

    if (data.type === "session_switched") {
      const store = useChatStore.getState();
      store.clearMessages();
      store.clearToolExecutions();

      setSession({
        sessionId: data.sessionId,
        sessionPath: data.sessionPath ?? null,
        model: data.model,
        thinkingLevel: data.thinkingLevel ?? "off",
        isStreaming: false,
      });

      // Rebuild chat messages from the loaded session history
      if (data.messages?.length) {
        for (const msg of data.messages) {
          if (msg.role === "user") {
            addMessage({
              id: nextId(),
              role: "user",
              content: msg.content,
              timestamp: msg.timestamp,
            });
          } else if (msg.role === "assistant") {
            addMessage({
              id: nextId(),
              role: "assistant",
              content: msg.content,
              timestamp: msg.timestamp,
              model: msg.model,
              thinkingContent: msg.thinkingContent,
              isStreaming: false,
            });
            // Add tool calls as separate messages
            if (msg.toolCalls?.length) {
              for (const tc of msg.toolCalls) {
                addMessage({
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
            addMessage({
              id: `toolresult-${msg.toolCallId ?? nextId()}`,
              role: "tool_result",
              content: msg.content,
              timestamp: msg.timestamp,
              toolName: msg.toolName,
              toolCallId: msg.toolCallId,
              isError: msg.isError,
            });
          } else if (msg.role === "system") {
            addMessage({
              id: nextId(),
              role: "system",
              content: msg.content,
              timestamp: msg.timestamp,
            });
          }
        }
      }
      return;
    }

    if (data.type === "error") {
      addMessage({
        id: nextId(),
        role: "system",
        content: `Error: ${data.message}`,
        timestamp: Date.now(),
      });
      return;
    }

    if (data.type === "response") {
      // Handle specific responses
      if (data.command === "get_models" && data.success) {
        setModels(data.data.models);
      }
      if (data.command === "set_model" && data.success) {
        setSession({ model: data.data });
      }
      if (data.command === "list_persisted_sessions" && data.success) {
        setSavedSessions(data.data.sessions);
        setSavedSessionsLoading(false);
      }
      return;
    }

    if (data.type === "event") {
      handlePiEvent(data.event);
    }
  }, []);

  const handlePiEvent = useCallback((event: any) => {
    const store = useChatStore.getState();

    switch (event.type) {
      case "agent_start":
        setSession({ isStreaming: true });
        break;

      case "agent_end":
        setSession({ isStreaming: false });
        if (currentAssistantId.current) {
          updateMessage(currentAssistantId.current, { isStreaming: false });
          currentAssistantId.current = null;
        }
        break;

      case "message_start": {
        const msg = event.message;
        if (msg?.role === "assistant") {
          const id = nextId();
          currentAssistantId.current = id;
          addMessage({
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
        if (!delta || !currentAssistantId.current) break;

        if (delta.type === "text_delta") {
          const current = useChatStore.getState().messages.find(
            (m) => m.id === currentAssistantId.current
          );
          if (current) {
            updateMessage(currentAssistantId.current, {
              content: current.content + delta.delta,
            });
          }
        } else if (delta.type === "thinking_delta") {
          const current = useChatStore.getState().messages.find(
            (m) => m.id === currentAssistantId.current
          );
          if (current) {
            updateMessage(currentAssistantId.current, {
              thinkingContent: (current.thinkingContent ?? "") + delta.delta,
            });
          }
        }
        break;
      }

      case "message_end": {
        if (currentAssistantId.current) {
          updateMessage(currentAssistantId.current, { isStreaming: false });
        }
        break;
      }

      case "tool_execution_start": {
        setToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
        });
        addMessage({
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
        setToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
          partialResult: partial,
        });
        // Update the tool result message with partial output
        updateMessage(`toolresult-${event.toolCallId}`, {
          content: partial,
        });
        // If no result message exists yet, create one
        const exists = useChatStore.getState().messages.find(
          (m) => m.id === `toolresult-${event.toolCallId}`
        );
        if (!exists && partial) {
          addMessage({
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
        setToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: {},
          status: event.isError ? "error" : "complete",
          result: resultText,
          isError: event.isError,
        });
        // Update or create result message
        const existingResult = useChatStore.getState().messages.find(
          (m) => m.id === `toolresult-${event.toolCallId}`
        );
        if (existingResult) {
          updateMessage(`toolresult-${event.toolCallId}`, {
            content: resultText,
            isError: event.isError,
          });
        } else {
          addMessage({
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
        addMessage({
          id: nextId(),
          role: "system",
          content: `Compacting context (${event.reason})...`,
          timestamp: Date.now(),
        });
        break;

      case "auto_compaction_end":
        if (event.result) {
          addMessage({
            id: nextId(),
            role: "system",
            content: `Context compacted. Tokens before: ${event.result.tokensBefore}`,
            timestamp: Date.now(),
          });
        }
        break;
    }
  }, []);

  // Send command to server
  const send = useCallback((cmd: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  // Public API
  const sendPrompt = useCallback(
    (message: string) => {
      const store = useChatStore.getState();

      // Add user message to chat
      addMessage({
        id: nextId(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      });

      // Handle queuing during streaming
      if (store.session.isStreaming) {
        send({ type: "follow_up", message });
      } else {
        send({ type: "prompt", message });
      }
    },
    [send],
  );

  const abort = useCallback(() => {
    send({ type: "abort" });
  }, [send]);

  const setModel = useCallback(
    (provider: string, modelId: string) => {
      send({ type: "set_model", provider, modelId });
    },
    [send],
  );

  const setThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      send({ type: "set_thinking_level", level });
      setSession({ thinkingLevel: level });
    },
    [send],
  );

  const newSession = useCallback(
    (cwd?: string) => {
      useChatStore.getState().clearMessages();
      useChatStore.getState().clearToolExecutions();
      setSession({ sessionId: null, sessionPath: null });
      send({ type: "new_session", cwd });
    },
    [send],
  );

  const listSessions = useCallback(
    (cwd?: string) => {
      setSavedSessionsLoading(true);
      send({ type: "list_persisted_sessions", cwd });
    },
    [send],
  );

  const switchSession = useCallback(
    (sessionPath: string) => {
      useChatStore.getState().clearMessages();
      useChatStore.getState().clearToolExecutions();
      send({ type: "switch_session", sessionPath });
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
      setAuthStatus(data.providers);
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
    fetchModels,
    fetchAuthStatus,
  };
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
