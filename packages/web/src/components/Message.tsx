import { useState, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../lib/types";

// ── Inline diff helpers ─────────────────────────────────────────────

interface DiffLine {
  type: "removed" | "added" | "context";
  text: string;
}

function computeInlineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: DiffLine[] = [];
  for (const line of oldLines) {
    lines.push({ type: "removed", text: line });
  }
  for (const line of newLines) {
    lines.push({ type: "added", text: line });
  }
  return lines;
}

function isEditToolCall(message: ChatMessage): { oldText: string; newText: string; path: string } | null {
  if (message.role !== "tool_call") return null;
  const name = message.toolName?.toLowerCase();
  if (name !== "edit") return null;
  const args = message.toolArgs;
  if (!args) return null;
  const oldText = (args.oldText ?? args.old_text) as string | undefined;
  const newText = (args.newText ?? args.new_text) as string | undefined;
  const path = (args.path ?? args.file) as string | undefined;
  if (!oldText || !newText) return null;
  return { oldText, newText, path: path ?? "unknown" };
}

function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(() => computeInlineDiff(oldText, newText), [oldText, newText]);
  return (
    <pre className="font-mono text-xs max-h-80 overflow-y-auto">
      {lines.map((line, i) => {
        if (line.type === "removed") {
          return (
            <div key={i} className="bg-red-500/10 text-red-400">
              <span className="select-none opacity-60">- </span>
              {line.text}
            </div>
          );
        }
        if (line.type === "added") {
          return (
            <div key={i} className="bg-emerald-500/10 text-emerald-400">
              <span className="select-none opacity-60">+ </span>
              {line.text}
            </div>
          );
        }
        return (
          <div key={i} className="text-zinc-500">
            <span className="select-none opacity-60">  </span>
            {line.text}
          </div>
        );
      })}
    </pre>
  );
}

interface MessageProps {
  message: ChatMessage;
}

export const Message = memo(function Message({ message }: MessageProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [toolExpanded, setToolExpanded] = useState(false);

  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[90%] sm:max-w-[80%] rounded-2xl rounded-br-md bg-violet-600/20 border border-violet-500/20 px-3 py-2 sm:px-4 sm:py-2.5">
            <div className="prose-chat text-sm text-zinc-200 whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[95%] sm:max-w-[85%] space-y-2">
            {/* Model badge */}
            {message.model && (
              <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
                {message.model}
              </span>
            )}

            {/* Thinking block */}
            {message.thinkingContent && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
                <button
                  onClick={() => setThinkingExpanded(!thinkingExpanded)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                >
                  <svg
                    className={`h-3 w-3 transition-transform ${thinkingExpanded ? "rotate-90" : ""}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M6 4l8 6-8 6V4z" />
                  </svg>
                  Thinking
                </button>
                {thinkingExpanded && (
                  <div className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-500 whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {message.thinkingContent}
                  </div>
                )}
              </div>
            )}

            {/* Main content */}
            <div
              className={`prose-chat text-sm text-zinc-200 ${
                message.isStreaming ? "streaming-cursor" : ""
              }`}
            >
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              ) : message.isStreaming ? (
                <span className="text-zinc-500">...</span>
              ) : null}
            </div>

            {/* Per-message usage label */}
            {message.usage && !message.isStreaming && (
              <div className="text-[10px] font-mono text-zinc-600">
                ↑{abbreviateTokens(message.usage.input)} ↓{abbreviateTokens(message.usage.output)}
                {" · "}
                {message.usage.cost.total < 0.01 && message.usage.cost.total > 0
                  ? `$${message.usage.cost.total.toFixed(4)}`
                  : `$${message.usage.cost.total.toFixed(3)}`}
              </div>
            )}
          </div>
        </div>
      );

    case "tool_call": {
      const editData = isEditToolCall(message);
      if (editData) {
        return <EditToolCall message={message} editData={editData} />;
      }
      return (
        <div className="flex justify-start pl-2 sm:pl-4">
          <div className="max-w-[95%] sm:max-w-[85%] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-medium text-amber-500/80 uppercase">
                {message.toolName}
              </span>
              <span className="text-xs text-zinc-500 font-mono">
                {message.content}
              </span>
            </div>
          </div>
        </div>
      );
    }

    case "tool_result":
      return (
        <div className="flex justify-start pl-2 sm:pl-4">
          <div className="max-w-[95%] sm:max-w-[85%] rounded-lg border border-zinc-800 bg-zinc-900/30">
            <button
              onClick={() => setToolExpanded(!toolExpanded)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                message.isError
                  ? "text-red-400 hover:text-red-300"
                  : "text-zinc-500 hover:text-zinc-400"
              }`}
            >
              <svg
                className={`h-3 w-3 transition-transform ${toolExpanded ? "rotate-90" : ""}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M6 4l8 6-8 6V4z" />
              </svg>
              <span className="font-mono uppercase text-[10px]">{message.toolName}</span>
              <span>
                {message.isError ? "error" : "result"}
              </span>
              {!toolExpanded && message.content && (
                <span className="truncate text-zinc-600 max-w-xs">
                  {message.content.slice(0, 100)}
                </span>
              )}
            </button>
            {toolExpanded && message.content && (
              <div className="border-t border-zinc-800 px-3 py-2">
                <pre className="text-xs text-zinc-400 whitespace-pre-wrap max-h-80 overflow-y-auto font-mono">
                  {message.content}
                </pre>
              </div>
            )}
          </div>
        </div>
      );

    case "system":
      return (
        <div className="flex justify-center">
          <span className="rounded-full bg-zinc-800/50 px-3 py-1 text-xs text-zinc-500">
            {message.content}
          </span>
        </div>
      );

    default:
      return null;
  }
});

function EditToolCall({
  message,
  editData,
}: {
  message: ChatMessage;
  editData: { oldText: string; newText: string; path: string };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex justify-start pl-2 sm:pl-4">
      <div className="max-w-[95%] sm:max-w-[85%] rounded-lg border border-zinc-800 bg-zinc-900/30">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M6 4l8 6-8 6V4z" />
          </svg>
          <span className="font-mono font-medium text-[10px] text-amber-500/80 uppercase">
            {message.toolName}
          </span>
          <span className="font-mono text-zinc-500">
            {message.content}
          </span>
        </button>
        {expanded && (
          <div className="border-t border-zinc-800 px-3 py-2">
            <InlineDiff oldText={editData.oldText} newText={editData.newText} />
          </div>
        )}
      </div>
    </div>
  );
}

function abbreviateTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
