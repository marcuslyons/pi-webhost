import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../lib/types";

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
          </div>
        </div>
      );

    case "tool_call":
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
