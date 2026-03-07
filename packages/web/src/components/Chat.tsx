import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { Message } from "./Message";
import { Editor } from "./Editor";
import type { ChatMessage } from "../lib/types";
import { Footer } from "./Footer";

interface ChatProps {
  agent: {
    sendPrompt: (message: string, images?: Array<{ data: string; mimeType: string }>) => void;
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

  // ── Search state ─────────────────────────────────────────────────

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const debounceSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce the search query
  useEffect(() => {
    if (debounceSearchRef.current) clearTimeout(debounceSearchRef.current);
    debounceSearchRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setCurrentMatchIndex(0);
    }, 200);
    return () => { if (debounceSearchRef.current) clearTimeout(debounceSearchRef.current); };
  }, [searchQuery]);

  // Compute matching message IDs
  const matchingIds = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    return messages
      .filter((m) => m.content?.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [messages, debouncedQuery]);

  const matchSet = useMemo(() => new Set(matchingIds), [matchingIds]);

  // Scroll to current match
  useEffect(() => {
    if (matchingIds.length === 0) return;
    const targetId = matchingIds[currentMatchIndex];
    if (!targetId) return;
    const el = messageRefs.current.get(targetId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentMatchIndex, matchingIds]);

  // Cmd+F / Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setDebouncedQuery("");
    setCurrentMatchIndex(0);
  }, []);

  const navigateMatch = useCallback((direction: "next" | "prev") => {
    if (matchingIds.length === 0) return;
    setCurrentMatchIndex((i) => {
      if (direction === "next") return i < matchingIds.length - 1 ? i + 1 : 0;
      return i > 0 ? i - 1 : matchingIds.length - 1;
    });
  }, [matchingIds.length]);

  // Close search on session change
  useEffect(() => {
    closeSearch();
  }, [activeSessionId, closeSearch]);

  // ── Auto-scroll ──────────────────────────────────────────────────

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current && !searchOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, searchOpen]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  // Ref callback for message elements
  const setMessageRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      messageRefs.current.set(id, el);
    } else {
      messageRefs.current.delete(id);
    }
  }, []);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2">
          <svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter" && !e.shiftKey) navigateMatch("next");
              if (e.key === "Enter" && e.shiftKey) navigateMatch("prev");
            }}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            autoFocus
          />
          {debouncedQuery && (
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {matchingIds.length > 0
                ? `${currentMatchIndex + 1} of ${matchingIds.length}`
                : "No matches"}
            </span>
          )}
          <button
            onClick={() => navigateMatch("prev")}
            disabled={matchingIds.length === 0}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
            title="Previous (Shift+Enter)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={() => navigateMatch("next")}
            disabled={matchingIds.length === 0}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
            title="Next (Enter)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={closeSearch}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Close (Escape)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-4xl space-y-3 px-2 py-4 sm:space-y-4 sm:px-4 sm:py-6">
            {messages.map((msg) => {
              const isMatch = matchSet.has(msg.id);
              const isCurrent = matchingIds[currentMatchIndex] === msg.id;
              return (
                <div
                  key={msg.id}
                  ref={(el) => setMessageRef(msg.id, el)}
                  className={
                    isMatch
                      ? `rounded-lg transition-colors ${isCurrent ? "ring-1 ring-violet-500/50 bg-violet-500/5" : "ring-1 ring-zinc-700 bg-zinc-800/20"}`
                      : ""
                  }
                >
                  <Message message={msg} />
                </div>
              );
            })}
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
