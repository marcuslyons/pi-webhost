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
