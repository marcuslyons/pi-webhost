import { useChatStore } from "../stores/chatStore";
import { useState } from "react";
import { NewSessionDialog } from "./NewSessionDialog";
import type { ThinkingLevel } from "../lib/types";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

interface HeaderProps {
  onMenuClick: () => void;
  agent: {
    setModel: (provider: string, modelId: string) => void;
    setThinkingLevel: (level: ThinkingLevel) => void;
    newSession: (cwd?: string) => void;
    abort: () => void;
  };
}

export function Header({ onMenuClick, agent }: HeaderProps) {
  const activeModel = useChatStore((s) => s.activeModel);
  const thinkingLevel = useChatStore((s) => s.activeThinkingLevel);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);
  const activeCwd = useChatStore((s) => s.activeCwd);
  const serverHome = useChatStore((s) => s.serverHome);
  const models = useChatStore((s) => s.models);
  const connected = useChatStore((s) => s.connected);
  const liveSessions = useChatStore((s) => s.liveSessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const bgStreaming = liveSessions.filter(
    (ls) => ls.isStreaming && ls.id !== activeSessionId
  ).length;

  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const shortenPath = (p: string) => {
    if (serverHome && p.startsWith(serverHome)) {
      return "~" + p.slice(serverHome.length);
    }
    return p;
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
        {/* Menu button */}
        <button
          onClick={onMenuClick}
          className="relative rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          title="Toggle sidebar"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {bgStreaming > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-violet-500 text-[8px] font-bold text-white">
              {bgStreaming}
            </span>
          )}
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-violet-400">π</span>
          <span className="text-sm font-medium text-zinc-300 hidden sm:inline">pi-webhost</span>
        </div>

        {/* Working directory */}
        {activeCwd && (
          <div className="flex items-center gap-1.5 min-w-0 max-w-xs" title={activeCwd}>
            <svg className="h-3.5 w-3.5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate font-mono text-xs text-zinc-500">
              {shortenPath(activeCwd)}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Model selector */}
        {models.length > 0 && (
          <select
            value={activeModel ? `${activeModel.provider}:${activeModel.id}` : ""}
            onChange={(e) => {
              const [provider, ...rest] = e.target.value.split(":");
              agent.setModel(provider, rest.join(":"));
            }}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500 transition-colors"
          >
            {!activeModel && <option value="">Select model...</option>}
            {models.map((m) => (
              <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        )}

        {/* Thinking level */}
        <select
          value={thinkingLevel}
          onChange={(e) => agent.setThinkingLevel(e.target.value as ThinkingLevel)}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500 transition-colors"
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              thinking: {level}
            </option>
          ))}
        </select>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              connected
                ? isStreaming
                  ? "bg-violet-500 animate-pulse"
                  : "bg-emerald-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs text-zinc-500 hidden sm:inline">
            {connected
              ? isStreaming
                ? "streaming"
                : "ready"
              : "disconnected"}
          </span>
        </div>

        {/* Abort button */}
        {isStreaming && (
          <button
            onClick={() => agent.abort()}
            className="rounded-md bg-red-900/50 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/80 transition-colors"
          >
            Stop
          </button>
        )}

        {/* New session */}
        <button
          onClick={() => setNewSessionOpen(true)}
          className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          title="New session"
        >
          + New
        </button>
      </header>

      <NewSessionDialog
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreateSession={(cwd) => agent.newSession(cwd)}
      />
    </>
  );
}
