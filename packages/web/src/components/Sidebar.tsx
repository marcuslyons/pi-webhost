import { useChatStore } from "../stores/chatStore";
import { useEffect, useState } from "react";
import type { SavedSessionInfo } from "../lib/types";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  agent: {
    fetchAuthStatus: () => Promise<void>;
    listSessions: (cwd?: string) => void;
    switchSession: (sessionPath: string) => void;
    newSession: (cwd?: string) => void;
  };
}

export function Sidebar({ open, onClose, agent }: SidebarProps) {
  const authStatus = useChatStore((s) => s.authStatus);
  const savedSessions = useChatStore((s) => s.savedSessions);
  const savedSessionsLoading = useChatStore((s) => s.savedSessionsLoading);
  const currentSessionPath = useChatStore((s) => s.session.sessionPath);
  const [apiKeyForm, setApiKeyForm] = useState({ provider: "anthropic", apiKey: "" });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"sessions" | "settings">("sessions");

  // Fetch sessions when sidebar opens
  useEffect(() => {
    if (open) {
      agent.listSessions();
    }
  }, [open, agent]);

  const handleSaveKey = async () => {
    if (!apiKeyForm.apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/auth/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiKeyForm),
      });
      if (res.ok) {
        setApiKeyForm({ ...apiKeyForm, apiKey: "" });
        await agent.fetchAuthStatus();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchSession = (session: SavedSessionInfo) => {
    agent.switchSession(session.path);
    onClose();
  };

  const handleNewSession = () => {
    agent.newSession();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-80 transform bg-zinc-900 border-r border-zinc-800 transition-transform duration-200 lg:relative lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-violet-400">π</span>
              <span className="text-sm font-medium text-zinc-300">pi-webhost</span>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:text-zinc-200 lg:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-zinc-800">
            <button
              onClick={() => setActiveTab("sessions")}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === "sessions"
                  ? "text-violet-400 border-b-2 border-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Sessions
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === "settings"
                  ? "text-violet-400 border-b-2 border-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Settings
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === "sessions" ? (
              <SessionsTab
                sessions={savedSessions}
                loading={savedSessionsLoading}
                currentSessionPath={currentSessionPath}
                onSwitch={handleSwitchSession}
                onNew={handleNewSession}
                onRefresh={() => agent.listSessions()}
              />
            ) : (
              <SettingsTab
                authStatus={authStatus}
                apiKeyForm={apiKeyForm}
                setApiKeyForm={setApiKeyForm}
                saving={saving}
                onSaveKey={handleSaveKey}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sessions Tab ──────────────────────────────────────────────────────

function SessionsTab({
  sessions,
  loading,
  currentSessionPath,
  onSwitch,
  onNew,
  onRefresh,
}: {
  sessions: SavedSessionInfo[];
  loading: boolean;
  currentSessionPath: string | null;
  onSwitch: (session: SavedSessionInfo) => void;
  onNew: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="p-3 space-y-3">
      {/* New session button */}
      <button
        onClick={onNew}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2.5 text-sm text-zinc-400 hover:border-violet-500/50 hover:text-zinc-200 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Session
      </button>

      {/* Session list header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Recent Sessions
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <svg
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Loading state */}
      {loading && sessions.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <span className="text-xs text-zinc-600">Loading sessions...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="text-xs text-zinc-600">No saved sessions</span>
          <span className="mt-1 text-[10px] text-zinc-700">
            Send a message to start a session
          </span>
        </div>
      )}

      {/* Session list */}
      <div className="space-y-1">
        {sessions.map((session) => {
          const isCurrent = currentSessionPath === session.path;
          const modified = new Date(session.modified);
          const timeStr = formatRelativeTime(modified);

          return (
            <button
              key={session.path}
              onClick={() => !isCurrent && onSwitch(session)}
              disabled={isCurrent}
              className={`group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                isCurrent
                  ? "bg-violet-500/10 border border-violet-500/20"
                  : "hover:bg-zinc-800/70 border border-transparent"
              }`}
            >
              {/* Title row */}
              <div className="flex items-center gap-2">
                {isCurrent && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                )}
                <span
                  className={`truncate text-sm font-medium ${
                    isCurrent ? "text-violet-300" : "text-zinc-300 group-hover:text-zinc-100"
                  }`}
                >
                  {session.name || truncateMessage(session.firstMessage) || "Untitled"}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{timeStr}</span>
                <span>·</span>
                <span>{session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}</span>
                {session.name && session.firstMessage && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-[140px]">
                      {truncateMessage(session.firstMessage)}
                    </span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────

function SettingsTab({
  authStatus,
  apiKeyForm,
  setApiKeyForm,
  saving,
  onSaveKey,
}: {
  authStatus: Record<string, { hasCredentials: boolean }>;
  apiKeyForm: { provider: string; apiKey: string };
  setApiKeyForm: (form: { provider: string; apiKey: string }) => void;
  saving: boolean;
  onSaveKey: () => void;
}) {
  return (
    <div className="p-4 space-y-6">
      {/* Auth Status */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Provider Authentication
        </h3>
        <div className="space-y-2">
          {Object.entries(authStatus).map(([provider, status]) => (
            <div
              key={provider}
              className="flex items-center justify-between rounded-md bg-zinc-800/50 px-3 py-2"
            >
              <span className="text-sm text-zinc-300 capitalize">{provider}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  status.hasCredentials
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-zinc-700 text-zinc-400"
                }`}
              >
                {status.hasCredentials ? "Connected" : "Not configured"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* API Key Input */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Add API Key
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Keys set here are runtime-only and not persisted to disk.
          For persistent keys, use environment variables or Pi's auth.json.
        </p>
        <div className="space-y-2">
          <select
            value={apiKeyForm.provider}
            onChange={(e) => setApiKeyForm({ ...apiKeyForm, provider: e.target.value })}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 outline-none focus:border-violet-500"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
            <option value="openrouter">OpenRouter</option>
            <option value="mistral">Mistral</option>
            <option value="groq">Groq</option>
            <option value="xai">xAI</option>
          </select>
          <input
            type="password"
            value={apiKeyForm.apiKey}
            onChange={(e) => setApiKeyForm({ ...apiKeyForm, apiKey: e.target.value })}
            placeholder="sk-..."
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-violet-500"
            onKeyDown={(e) => e.key === "Enter" && onSaveKey()}
          />
          <button
            onClick={onSaveKey}
            disabled={saving || !apiKeyForm.apiKey.trim()}
            className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Set API Key"}
          </button>
        </div>
      </section>

      {/* OAuth Info */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          OAuth Login
        </h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          To use OAuth login (Anthropic Pro/Max, OpenAI Plus/Pro), run{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-violet-400">pi</code>{" "}
          in your terminal and use the{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-violet-400">/login</code>{" "}
          command. Credentials are stored in{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">~/.pi/agent/auth.json</code>{" "}
          and will be picked up by pi-webhost automatically.
        </p>
      </section>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function truncateMessage(msg: string, maxLen = 60): string {
  if (!msg) return "";
  const cleaned = msg.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "…";
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
