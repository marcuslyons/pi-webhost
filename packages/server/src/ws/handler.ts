/**
 * WebSocket handler that bridges Pi AgentSession events to the browser.
 *
 * Protocol:
 * - Client sends JSON commands (prompt, abort, set_model, etc.)
 * - Server streams Pi events as JSON
 */

import type { WSContext, WSEvents, WSMessageReceive } from "hono/ws";
import type { AgentManager, ManagedSession } from "../agent/manager.js";
import type { ImageContent } from "@mariozechner/pi-ai";

// Commands the client can send
type ClientCommand =
  | { type: "prompt"; message: string; images?: Array<{ data: string; mimeType: string }> }
  | { type: "abort" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: string }
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_models" }
  | { type: "compact"; customInstructions?: string }
  | { type: "new_session"; cwd?: string }
  | { type: "steer"; message: string }
  | { type: "follow_up"; message: string };

function send(ws: WSContext, data: unknown) {
  ws.send(JSON.stringify(data));
}

/**
 * Create WSEvents handlers for a WebSocket connection.
 * Called by Hono's upgradeWebSocket.
 */
export function createWSHandlers(agentManager: AgentManager): WSEvents {
  let managed: ManagedSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let wsRef: WSContext | undefined;

  const setupEventForwarding = (session: ManagedSession) => {
    if (unsubscribe) unsubscribe();

    unsubscribe = session.session.subscribe((event) => {
      if (!wsRef) return;
      try {
        send(wsRef, { type: "event", event: serializeEvent(event) });
      } catch {
        // Client disconnected
      }
    });
  };

  return {
    onOpen(_evt, ws) {
      wsRef = ws;
    },

    async onMessage(evt, ws) {
      wsRef = ws;
      let cmd: ClientCommand;
      try {
        const raw = typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
        cmd = JSON.parse(raw);
      } catch {
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      try {
        await handleCommand(cmd, ws, agentManager, () => managed, (m) => {
          managed = m;
          if (m) setupEventForwarding(m);
        }, unsubscribe);
      } catch (err) {
        send(ws, { type: "error", message: String(err) });
      }
    },

    async onClose() {
      if (unsubscribe) unsubscribe();
      if (managed) {
        await agentManager.destroySession(managed.id);
      }
      wsRef = undefined;
    },
  };
}

async function handleCommand(
  cmd: ClientCommand,
  ws: WSContext,
  agentManager: AgentManager,
  getManaged: () => ManagedSession | undefined,
  setManaged: (m: ManagedSession) => void,
  unsubscribe: (() => void) | undefined,
) {
  let managed = getManaged();

  switch (cmd.type) {
    case "prompt": {
      if (!managed) {
        managed = await agentManager.createSession();
        setManaged(managed);
        send(ws, {
          type: "session_created",
          sessionId: managed.id,
          model: managed.session.model
            ? { provider: managed.session.model.provider, id: managed.session.model.id, name: managed.session.model.name }
            : null,
        });
      }

      const images: ImageContent[] | undefined = cmd.images?.length
        ? cmd.images.map((img) => ({
            type: "image" as const,
            data: img.data,
            mimeType: img.mimeType,
          }))
        : undefined;

      // Don't await — let it stream
      managed.session.prompt(cmd.message, images ? { images } : undefined).catch((err) => {
        send(ws, { type: "error", message: String(err) });
      });

      send(ws, { type: "response", command: "prompt", success: true });
      break;
    }

    case "abort": {
      if (managed) {
        await managed.session.abort();
      }
      send(ws, { type: "response", command: "abort", success: true });
      break;
    }

    case "steer": {
      if (managed) {
        await managed.session.steer(cmd.message);
      }
      send(ws, { type: "response", command: "steer", success: true });
      break;
    }

    case "follow_up": {
      if (managed) {
        await managed.session.followUp(cmd.message);
      }
      send(ws, { type: "response", command: "follow_up", success: true });
      break;
    }

    case "set_model": {
      if (!managed) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      const model = agentManager.getModelRegistry().find(cmd.provider, cmd.modelId);
      if (!model) {
        send(ws, { type: "error", message: `Model not found: ${cmd.provider}/${cmd.modelId}` });
        break;
      }
      await managed.session.setModel(model);
      send(ws, {
        type: "response",
        command: "set_model",
        success: true,
        data: { provider: model.provider, id: model.id, name: model.name },
      });
      break;
    }

    case "set_thinking_level": {
      if (!managed) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      managed.session.setThinkingLevel(cmd.level as any);
      send(ws, { type: "response", command: "set_thinking_level", success: true });
      break;
    }

    case "get_state": {
      if (!managed) {
        send(ws, {
          type: "response",
          command: "get_state",
          success: true,
          data: { hasSession: false },
        });
        break;
      }
      send(ws, {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          hasSession: true,
          sessionId: managed.id,
          isStreaming: managed.session.isStreaming,
          model: managed.session.model
            ? { provider: managed.session.model.provider, id: managed.session.model.id, name: managed.session.model.name }
            : null,
          thinkingLevel: managed.session.thinkingLevel,
          messageCount: managed.session.messages.length,
        },
      });
      break;
    }

    case "get_messages": {
      if (!managed) {
        send(ws, { type: "response", command: "get_messages", success: true, data: { messages: [] } });
        break;
      }
      send(ws, {
        type: "response",
        command: "get_messages",
        success: true,
        data: { messages: managed.session.messages },
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
      if (!managed) {
        send(ws, { type: "error", message: "No active session" });
        break;
      }
      const result = await managed.session.compact(cmd.customInstructions);
      send(ws, { type: "response", command: "compact", success: true, data: result });
      break;
    }

    case "new_session": {
      if (managed) {
        if (unsubscribe) unsubscribe();
        await agentManager.destroySession(managed.id);
      }

      const newManaged = await agentManager.createSession({ cwd: cmd.cwd });
      setManaged(newManaged);
      send(ws, {
        type: "session_created",
        sessionId: newManaged.id,
        model: newManaged.session.model
          ? { provider: newManaged.session.model.provider, id: newManaged.session.model.id, name: newManaged.session.model.name }
          : null,
      });
      break;
    }

    default:
      send(ws, { type: "error", message: `Unknown command: ${(cmd as any).type}` });
  }
}

/**
 * Serialize Pi events for JSON transport.
 */
function serializeEvent(event: any): any {
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    return { type: event.type, error: "Failed to serialize event" };
  }
}
