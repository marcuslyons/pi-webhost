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
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system";
  content: string;
  timestamp: number;
  // Assistant-specific
  model?: string;
  thinkingContent?: string;
  isStreaming?: boolean;
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
  isStreaming: boolean;
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
}
