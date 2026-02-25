import { useChatStore } from "../stores/chatStore";
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
  const session = useChatStore((s) => s.session);
  const models = useChatStore((s) => s.models);
  const connected = useChatStore((s) => s.connected);

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
      {/* Menu button */}
      <button
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        title="Toggle sidebar"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-violet-400">π</span>
        <span className="text-sm font-medium text-zinc-300">pi-webhost</span>
      </div>

      <div className="flex-1" />

      {/* Model selector */}
      {models.length > 0 && (
        <select
          value={session.model ? `${session.model.provider}:${session.model.id}` : ""}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split(":");
            agent.setModel(provider, rest.join(":"));
          }}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500 transition-colors"
        >
          {!session.model && <option value="">Select model...</option>}
          {models.map((m) => (
            <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
              {m.name} ({m.provider})
            </option>
          ))}
        </select>
      )}

      {/* Thinking level */}
      <select
        value={session.thinkingLevel}
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
              ? session.isStreaming
                ? "bg-violet-500 animate-pulse"
                : "bg-emerald-500"
              : "bg-red-500"
          }`}
        />
        <span className="text-xs text-zinc-500">
          {connected
            ? session.isStreaming
              ? "streaming"
              : "ready"
            : "disconnected"}
        </span>
      </div>

      {/* Abort button (visible during streaming) */}
      {session.isStreaming && (
        <button
          onClick={agent.abort}
          className="rounded-md bg-red-900/50 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/80 transition-colors"
        >
          Stop
        </button>
      )}

      {/* New session */}
      <button
        onClick={() => agent.newSession()}
        className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        title="New session"
      >
        + New
      </button>
    </header>
  );
}
