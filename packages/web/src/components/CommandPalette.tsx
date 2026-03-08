import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";

interface Command {
  id: string;
  icon: string;
  label: string;
  description?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onCompact: () => void;
}

export function CommandPalette({ open, onClose, onNewSession, onCompact }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const statsData = useChatStore((s) => {
    if (!s.activeSessionId) return null;
    return s.sessionStatsMap.get(s.activeSessionId) ?? null;
  });

  const [showStats, setShowStats] = useState(false);

  const commands: Command[] = useMemo(() => [
    {
      id: "compact",
      icon: "🗜️",
      label: "Compact",
      description: "Compact context for the active session",
      action: () => {
        onCompact();
        onClose();
      },
    },
    {
      id: "stats",
      icon: "📊",
      label: "Session Stats",
      description: "Show token usage and cost for this session",
      action: () => {
        setShowStats(true);
      },
    },
    {
      id: "search",
      icon: "🔍",
      label: "Search Messages",
      description: "Search within the current session (Cmd+F)",
      action: () => {
        onClose();
        // Trigger the existing search by dispatching Cmd+F
        setTimeout(() => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true })
          );
        }, 50);
      },
    },
    {
      id: "new-session",
      icon: "🆕",
      label: "New Session",
      description: "Start a new agent session",
      action: () => {
        onClose();
        onNewSession();
      },
    },
  ], [onCompact, onClose, onNewSession]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setShowStats(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Clamp selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.children;
    const item = items[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const cmd = filtered[selectedIndex];
    if (cmd) cmd.action();
  }, [filtered, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
          break;
        case "Enter":
          e.preventDefault();
          executeSelected();
          break;
        case "Escape":
          e.preventDefault();
          if (showStats) {
            setShowStats(false);
          } else {
            onClose();
          }
          break;
      }
    },
    [filtered.length, executeSelected, onClose, showStats],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {showStats ? (
          <StatsView
            stats={statsData}
            sessionId={activeSessionId}
            onBack={() => setShowStats(false)}
          />
        ) : (
          <>
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command…"
                className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              />
              <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 border border-zinc-700">
                ESC
              </kbd>
            </div>

            {/* Command list */}
            <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-zinc-600">
                  No matching commands
                </div>
              ) : (
                filtered.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    onClick={() => cmd.action()}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === selectedIndex
                        ? "bg-violet-500/10 text-zinc-200"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    <span className="text-base shrink-0">{cmd.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{cmd.label}</div>
                      {cmd.description && (
                        <div className="text-xs text-zinc-600 truncate">{cmd.description}</div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Stats sub-view ──────────────────────────────────────────────────

function StatsView({
  stats,
  sessionId,
  onBack,
}: {
  stats: { stats: import("../lib/types").SessionStats; context: import("../lib/types").ContextUsage | null } | null;
  sessionId: string | null;
  onBack: () => void;
}) {
  if (!stats || !sessionId) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-zinc-500">No session active</p>
        <button onClick={onBack} className="mt-3 text-xs text-violet-400 hover:text-violet-300">
          ← Back
        </button>
      </div>
    );
  }

  const { stats: s, context } = stats;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-zinc-300">Session Stats</span>
      </div>

      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <StatItem label="Messages" value={String(s.totalMessages)} />
          <StatItem label="Tool Calls" value={String(s.toolCalls)} />
          <StatItem label="User Messages" value={String(s.userMessages)} />
          <StatItem label="Assistant Messages" value={String(s.assistantMessages)} />
        </div>

        <div className="border-t border-zinc-800 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <StatItem label="Input Tokens" value={formatTokens(s.tokens.input)} />
            <StatItem label="Output Tokens" value={formatTokens(s.tokens.output)} />
            <StatItem label="Cache Read" value={formatTokens(s.tokens.cacheRead)} />
            <StatItem label="Cache Write" value={formatTokens(s.tokens.cacheWrite)} />
            <StatItem label="Total Tokens" value={formatTokens(s.tokens.total)} />
            <StatItem
              label="Cost"
              value={s.cost < 0.01 && s.cost > 0 ? `$${s.cost.toFixed(4)}` : `$${s.cost.toFixed(3)}`}
            />
          </div>
        </div>

        {context && (
          <div className="border-t border-zinc-800 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <StatItem
                label="Context Used"
                value={context.percent != null ? `${context.percent.toFixed(1)}%` : "—"}
              />
              <StatItem
                label="Context Window"
                value={formatTokens(context.contextWindow)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
      <div className="text-[10px] text-zinc-600 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-mono text-zinc-300 mt-0.5">{value}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
