import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { useChatStore } from "../stores/chatStore";

interface EditorProps {
  onSend: (message: string) => void;
  onAbort: () => void;
}

export function Editor({ onSend, onAbort }: EditorProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Ctrl+C / Escape to abort during streaming
      if ((e.key === "Escape" || (e.key === "c" && e.ctrlKey)) && isStreaming) {
        e.preventDefault();
        onAbort();
      }
    },
    [handleSubmit, isStreaming, onAbort],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/50 p-2 sm:p-4">
      <div
        className={`flex items-center gap-2 rounded-xl border bg-zinc-900 px-3 py-2 transition-colors ${
          isStreaming
            ? "border-violet-500/40"
            : "border-zinc-700 focus-within:border-violet-500/60"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? "Type to queue a follow-up... (Escape to abort)"
              : "Type a message... (Shift+Enter for new line)"
          }
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          autoFocus
        />

        {/* Send / Abort button */}
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="shrink-0 rounded-lg bg-red-900/50 p-2 text-red-300 hover:bg-red-900/80 transition-colors"
            title="Abort (Escape)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="shrink-0 rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] text-zinc-600">
          Shift+Enter for new line · Escape to abort
        </span>
      </div>
    </div>
  );
}
