/**
 * Shared types for the WebSocket protocol between server and client.
 */

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

// Messages displayed in the chat UI
/** Per-message token/cost usage (from Pi's AssistantMessage.usage). */
export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system";
  content: string;
  timestamp: number;
  // Assistant-specific
  model?: string;
  thinkingContent?: string;
  isStreaming?: boolean;
  usage?: MessageUsage;
  // Tool-specific
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  partialResult?: string;
  result?: string;
  isError?: boolean;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SessionState {
  sessionId: string | null;
  sessionPath: string | null;
  isStreaming: boolean;
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
}

export interface SavedSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string; // ISO date
  modified: string; // ISO date
  messageCount: number;
  firstMessage: string;
}

/** Token and cost statistics for a session. */
export interface SessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
}

/** Context window usage for a session. */
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** A session that's currently alive in this browser tab. */
export interface LiveSessionInfo {
  id: string;
  sessionPath: string | null;
  cwd: string;
  isStreaming: boolean;
  model: ModelInfo | null;
  messageCount: number;
  cost?: number;
}

/** Per-session data cached on the client. */
export interface SessionData {
  messages: ChatMessage[];
  toolExecutions: Map<string, ToolExecution>;
  /** Track the current assistant message being streamed. */
  currentAssistantId: string | null;
}

// ── Extension UI Protocol ─────────────────────────────────────────

/** A dialog request from a Pi extension, forwarded by the server. */
export type ExtensionUIRequest =
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; sessionId: string; id: string; method: "set_editor_text"; text: string };

/** A dialog request that requires user response. */
export type ExtensionUIDialog = Extract<ExtensionUIRequest, { method: "select" | "confirm" | "input" | "editor" }>;

/** A notification from a Pi extension (fire-and-forget). */
export interface ExtensionNotification {
  id: string;
  message: string;
  notifyType: "info" | "warning" | "error";
  timestamp: number;
}
