import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { Message } from "./Message";
import { Editor } from "./Editor";
import { Footer } from "./Footer";

interface ChatProps {
  agent: {
    sendPrompt: (message: string) => void;
    abort: () => void;
  };
}

export function Chat({ agent }: ChatProps) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessionDataMap = useChatStore((s) => s.sessionDataMap);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);
  const messages = activeSessionId
    ? sessionDataMap.get(activeSessionId)?.messages ?? []
    : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track if user has scrolled up
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
            {messages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}
            <div className="h-1" />
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="mx-auto w-full max-w-4xl">
        <Editor onSend={agent.sendPrompt} onAbort={agent.abort} />
      </div>

      {/* Telemetry footer */}
      <Footer />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <div className="text-6xl text-violet-400/30 font-bold">π</div>
      <h2 className="text-lg font-medium text-zinc-400">pi-webhost</h2>
      <p className="max-w-md text-center text-sm text-zinc-600">
        A web interface for the Pi coding agent. Type a message below to start a session.
        The agent has access to read, write, edit, and bash tools.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {[
          "What files are in this directory?",
          "Review the codebase structure",
          "Help me write a new feature",
        ].map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => {
              const textarea = document.querySelector("textarea");
              if (textarea) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value",
                )?.set;
                nativeInputValueSetter?.call(textarea, suggestion);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                textarea.focus();
              }
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500 hover:border-violet-500/30 hover:text-zinc-400 transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
