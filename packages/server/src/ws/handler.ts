/**
 * WebSocket handler that bridges Pi AgentSession events to the browser.
 *
 * Sessions are server-owned (live in AgentManager). Connections subscribe
 * to sessions and receive events — closing a connection does NOT destroy
 * sessions. Sessions persist until explicitly closed via close_session.
 *
 * Events from all subscribed sessions are forwarded, tagged with sessionId.
 * Commands target the active session unless a sessionId is specified.
 */

import type { WSContext, WSEvents } from "hono/ws";
import type { AgentManager, ManagedSession } from "../agent/manager.js";
import type { ImageContent } from "@mariozechner/pi-ai";

// Commands the client can send
type ClientCommand =
  | { type: "prompt"; message: string; sessionId?: string; images?: Array<{ data: string; mimeType: string }> }
  | { type: "abort"; sessionId?: string }
  | { type: "set_model"; provider: string; modelId: string; sessionId?: string }
  | { type: "set_thinking_level"; level: string; sessionId?: string }
  | { type: "get_state" }
  | { type: "get_messages"; sessionId?: string }
  | { type: "get_models" }
  | { type: "compact"; customInstructions?: string; sessionId?: string }
  | { type: "new_session"; cwd?: string }
  | { type: "steer"; message: string; sessionId?: string }
  | { type: "follow_up"; message: string; sessionId?: string }
  | { type: "list_persisted_sessions"; cwd?: string }
  | { type: "switch_session"; sessionPath: string }
  | { type: "set_active_session"; sessionId: string }
  | { type: "close_session"; sessionId: string }
  | { type: "attach_session"; sessionId: string }
  | { type: "detach_session"; sessionId: string }
  | { type: "list_active_sessions" };

function send(ws: WSContext, data: unknown) {
  ws.send(JSON.stringify(data));
}

/**
 * Per-connection state: tracks which sessions this client is subscribed to
 * and which one is active. Sessions themselves live in AgentManager.
 */
interface ConnectionState {
  /** Session IDs this connection is subscribed to (receives events for). */
  subscribedSessionIds: Set<string>;
  activeSessionId: string | null;
  ws: WSContext | undefined;
}

/**
 * Create WSEvents handlers for a WebSocket connection.
 */
export function createWSHandlers(agentManager: AgentManager): WSEvents {
  const state: ConnectionState = {
    subscribedSessionIds: new Set(),
    activeSessionId: null,
    ws: undefined,
  };

  /** The client handle for this connection, used with AgentManager's subscriber system. */
  const clientHandle = {
    send: (data: string) => {
      if (state.ws) {
        try { state.ws.send(data); } catch { /* disconnected */ }
      }
    },
  };

  function attachToSession(sessionId: string) {
    state.subscribedSessionIds.add(sessionId);
    agentManager.attachClient(sessionId, clientHandle);
  }

  function detachFromSession(sessionId: string) {
    state.subscribedSessionIds.delete(sessionId);
    agentManager.detachClient(sessionId, clientHandle);
  }

  function sendSessionInfo(ws: WSContext, type: string, sessionId: string, managed: ManagedSession, extra?: Record<string, unknown>) {
    send(ws, {
      type,
      sessionId,
      sessionPath: managed.session.sessionFile ?? null,
      cwd: managed.cwd,
      model: managed.session.model
        ? { provider: managed.session.model.provider, id: managed.session.model.id, name: managed.session.model.name }
        : null,
      ...extra,
    });
  }

  function getTargetSession(sessionId?: string): { id: string; managed: ManagedSession } | null {
    const id = sessionId ?? state.activeSessionId;
    if (!id) return null;
    const managed = agentManager.getSession(id);
    if (!managed) return null;
    return { id, managed };
  }

  /** Send a snapshot of this client's subscribed sessions. */
  function sendLiveSessionsList(ws: WSContext) {
    const liveSessions: any[] = [];
    for (const id of state.subscribedSessionIds) {
      const m = agentManager.getSession(id);
      if (!m) continue;
      liveSessions.push({
        id,
        sessionPath: m.session.sessionFile ?? null,
        cwd: m.cwd,
        isStreaming: m.session.isStreaming,
        model: m.session.model
          ? { provider: m.session.model.provider, id: m.session.model.id, name: m.session.model.name }
          : null,
        messageCount: m.session.messages.length,
      });
    }
    send(ws, {
      type: "live_sessions_update",
      activeSessionId: state.activeSessionId,
      sessions: liveSessions,
    });
  }

  return {
    onOpen(_evt, ws) {
      state.ws = ws;
    },

    async onMessage(evt, ws) {
      state.ws = ws;
      let cmd: ClientCommand;
      try {
        const raw = typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
        cmd = JSON.parse(raw);
      } catch {
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      try {
        await handleCommand(cmd, ws, agentManager, state, attachToSession, detachFromSession, sendSessionInfo, getTargetSession, sendLiveSessionsList);
      } catch (err) {
        send(ws, { type: "error", message: String(err) });
      }
    },

    async onClose() {
      // Detach from all sessions — sessions stay alive in AgentManager
      agentManager.detachAllForClient(clientHandle);
      state.subscribedSessionIds.clear();
      state.ws = undefined;
    },
  };
}

async function handleCommand(
  cmd: ClientCommand,
  ws: WSContext,
  agentManager: AgentManager,
  state: ConnectionState,
  attachToSession: (sessionId: string) => void,
  detachFromSession: (sessionId: string) => void,
  sendSessionInfo: (ws: WSContext, type: string, id: string, m: ManagedSession, extra?: Record<string, unknown>) => void,
  getTargetSession: (sessionId?: string) => { id: string; managed: ManagedSession } | null,
  sendLiveSessionsList: (ws: WSContext) => void,
) {
  switch (cmd.type) {
    case "prompt": {
      let target = getTargetSession(cmd.sessionId);

      if (!target) {
        // Auto-create session on first prompt
        const managed = await agentManager.createSession();
        attachToSession(managed.id);
        state.activeSessionId = managed.id;
        sendSessionInfo(ws, "session_created", managed.id, managed);
        sendLiveSessionsList(ws);
        target = { id: managed.id, managed };
      }

      const images: ImageContent[] | undefined = cmd.images?.length
        ? cmd.images.map((img) => ({
            type: "image" as const,
            data: img.data,
            mimeType: img.mimeType,
          }))
        : undefined;

      // Don't await — let it stream
      target.managed.session.prompt(cmd.message, images ? { images } : undefined).catch((err) => {
        send(ws, { type: "error", sessionId: target!.id, message: String(err) });
      });

      send(ws, { type: "response", command: "prompt", success: true, sessionId: target.id });
      break;
    }

    case "abort": {
      const target = getTargetSession(cmd.sessionId);
      if (target) {
        await target.managed.session.abort();
      }
      send(ws, { type: "response", command: "abort", success: true });
      break;
    }

    case "steer": {
      const target = getTargetSession(cmd.sessionId);
      if (target) {
        await target.managed.session.steer(cmd.message);
      }
      send(ws, { type: "response", command: "steer", success: true });
      break;
    }

    case "follow_up": {
      const target = getTargetSession(cmd.sessionId);
      if (target) {
        await target.managed.session.followUp(cmd.message);
      }
      send(ws, { type: "response", command: "follow_up", success: true });
      break;
    }

    case "set_model": {
      const target = getTargetSession(cmd.sessionId);
      if (!target) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      const model = agentManager.getModelRegistry().find(cmd.provider, cmd.modelId);
      if (!model) {
        send(ws, { type: "error", message: `Model not found: ${cmd.provider}/${cmd.modelId}` });
        break;
      }
      await target.managed.session.setModel(model);
      send(ws, {
        type: "response",
        command: "set_model",
        success: true,
        sessionId: target.id,
        data: { provider: model.provider, id: model.id, name: model.name },
      });
      break;
    }

    case "set_thinking_level": {
      const target = getTargetSession(cmd.sessionId);
      if (!target) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      target.managed.session.setThinkingLevel(cmd.level as any);
      send(ws, { type: "response", command: "set_thinking_level", success: true });
      break;
    }

    case "get_state": {
      const liveSessions: any[] = [];
      for (const id of state.subscribedSessionIds) {
        const m = agentManager.getSession(id);
        if (!m) continue;
        liveSessions.push({
          id,
          sessionPath: m.session.sessionFile ?? null,
          isStreaming: m.session.isStreaming,
          model: m.session.model
            ? { provider: m.session.model.provider, id: m.session.model.id, name: m.session.model.name }
            : null,
          thinkingLevel: m.session.thinkingLevel,
          messageCount: m.session.messages.length,
        });
      }
      send(ws, {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          activeSessionId: state.activeSessionId,
          sessions: liveSessions,
        },
      });
      break;
    }

    case "get_messages": {
      const target = getTargetSession(cmd.sessionId);
      if (!target) {
        send(ws, { type: "response", command: "get_messages", success: true, data: { messages: [] } });
        break;
      }
      send(ws, {
        type: "response",
        command: "get_messages",
        success: true,
        sessionId: target.id,
        data: { messages: target.managed.session.messages },
      });
      break;
    }

    case "get_models": {
      const models = await agentManager.getAvailableModels();
      send(ws, {
        type: "response",
        command: "get_models",
        success: true,
        data: {
          models: models.map((m) => ({
            provider: m.provider,
            id: m.id,
            name: m.name,
            reasoning: m.reasoning,
            contextWindow: m.contextWindow,
          })),
        },
      });
      break;
    }

    case "compact": {
      const target = getTargetSession(cmd.sessionId);
      if (!target) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      const result = await target.managed.session.compact(cmd.customInstructions);
      send(ws, { type: "response", command: "compact", success: true, data: result });
      break;
    }

    case "new_session": {
      // Create a new session WITHOUT destroying existing ones
      const managed = await agentManager.createSession({ cwd: cmd.cwd });
      attachToSession(managed.id);
      state.activeSessionId = managed.id;
      sendSessionInfo(ws, "session_created", managed.id, managed);
      sendLiveSessionsList(ws);
      break;
    }

    case "list_persisted_sessions": {
      const sessions = await agentManager.listPersistedSessions(cmd.cwd);
      send(ws, {
        type: "response",
        command: "list_persisted_sessions",
        success: true,
        data: { sessions },
      });
      break;
    }

    case "switch_session": {
      // Open a persisted session WITHOUT destroying existing ones
      const opened = await agentManager.openSession(cmd.sessionPath);
      attachToSession(opened.id);
      state.activeSessionId = opened.id;

      const messages = opened.session.messages.map(serializeAgentMessage);

      send(ws, {
        type: "session_switched",
        sessionId: opened.id,
        sessionPath: opened.session.sessionFile ?? cmd.sessionPath,
        cwd: opened.cwd,
        model: opened.session.model
          ? { provider: opened.session.model.provider, id: opened.session.model.id, name: opened.session.model.name }
          : null,
        thinkingLevel: opened.session.thinkingLevel,
        messages,
      });
      sendLiveSessionsList(ws);
      break;
    }

    case "set_active_session": {
      if (!state.subscribedSessionIds.has(cmd.sessionId)) {
        send(ws, { type: "error", message: `Session not found: ${cmd.sessionId}` });
        break;
      }
      state.activeSessionId = cmd.sessionId;
      send(ws, {
        type: "response",
        command: "set_active_session",
        success: true,
        data: { activeSessionId: cmd.sessionId },
      });
      sendLiveSessionsList(ws);
      break;
    }

    case "close_session": {
      detachFromSession(cmd.sessionId);
      await agentManager.destroySession(cmd.sessionId);

      // If we closed the active session, pick another or clear
      if (state.activeSessionId === cmd.sessionId) {
        const remaining = Array.from(state.subscribedSessionIds);
        state.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }

      send(ws, {
        type: "response",
        command: "close_session",
        success: true,
        data: { activeSessionId: state.activeSessionId },
      });
      sendLiveSessionsList(ws);
      break;
    }

    case "attach_session": {
      const managed = agentManager.getSession(cmd.sessionId);
      if (!managed) {
        send(ws, { type: "error", message: `Session not found: ${cmd.sessionId}` });
        break;
      }
      attachToSession(cmd.sessionId);
      state.activeSessionId = cmd.sessionId;

      const attachMessages = managed.session.messages.map(serializeAgentMessage);
      send(ws, {
        type: "session_switched",
        sessionId: cmd.sessionId,
        sessionPath: managed.session.sessionFile ?? null,
        cwd: managed.cwd,
        model: managed.session.model
          ? { provider: managed.session.model.provider, id: managed.session.model.id, name: managed.session.model.name }
          : null,
        thinkingLevel: managed.session.thinkingLevel,
        messages: attachMessages,
      });
      sendLiveSessionsList(ws);
      break;
    }

    case "detach_session": {
      detachFromSession(cmd.sessionId);
      if (state.activeSessionId === cmd.sessionId) {
        const remaining = Array.from(state.subscribedSessionIds);
        state.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      send(ws, {
        type: "response",
        command: "detach_session",
        success: true,
        data: { sessionId: cmd.sessionId, activeSessionId: state.activeSessionId },
      });
      sendLiveSessionsList(ws);
      break;
    }

    case "list_active_sessions": {
      // Return ALL sessions in the server's pool (not just this client's)
      const allSessions = agentManager.listSessions().map((s) => ({
        id: s.id,
        cwd: s.cwd,
        isStreaming: s.isStreaming,
        model: s.model,
        createdAt: s.createdAt.toISOString(),
      }));
      send(ws, {
        type: "response",
        command: "list_active_sessions",
        success: true,
        data: { sessions: allSessions },
      });
      break;
    }

    default:
      send(ws, { type: "error", message: `Unknown command: ${(cmd as any).type}` });
  }
}

/**
 * Convert a Pi AgentMessage into a simplified format for the client.
 */
function serializeAgentMessage(msg: any): any {
  if (msg.role === "user") {
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n")
        : "";
    return {
      role: "user",
      content,
      timestamp: msg.timestamp ?? Date.now(),
    };
  }

  if (msg.role === "assistant") {
    let textContent = "";
    let thinkingContent = "";
    const toolCalls: any[] = [];

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "thinking") {
          thinkingContent += block.thinking;
        } else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.arguments,
          });
        }
      }
    }

    return {
      role: "assistant",
      content: textContent,
      thinkingContent: thinkingContent || undefined,
      model: msg.model,
      timestamp: msg.timestamp ?? Date.now(),
      toolCalls,
    };
  }

  if (msg.role === "toolResult") {
    const resultText = Array.isArray(msg.content)
      ? msg.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      : typeof msg.content === "string"
        ? msg.content
        : "";
    return {
      role: "tool_result",
      content: resultText,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      isError: msg.isError,
      timestamp: msg.timestamp ?? Date.now(),
    };
  }

  return {
    role: "system",
    content: msg.content?.toString?.() ?? JSON.stringify(msg),
    timestamp: msg.timestamp ?? Date.now(),
  };
}
