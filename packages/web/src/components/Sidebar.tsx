import { useChatStore } from "../stores/chatStore";
import { useEffect, useRef, useState } from "react";
import type { LiveSessionInfo, SavedSessionInfo } from "../lib/types";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  agent: {
    fetchAuthStatus: () => Promise<void>;
    listSessions: (cwd?: string) => void;
    switchSession: (sessionPath: string) => void;
    setActiveSession: (sessionId: string) => void;
    closeSession: (sessionId: string) => void;
    newSession: (cwd?: string) => void;
    renameSession: (sessionPath: string, name: string) => void;
    deleteSession: (sessionPath: string) => void;
  };
}

export function Sidebar({ open, onClose, agent }: SidebarProps) {
  const authStatus = useChatStore((s) => s.authStatus);
  const savedSessions = useChatStore((s) => s.savedSessions);
  const savedSessionsLoading = useChatStore((s) => s.savedSessionsLoading);
  const liveSessions = useChatStore((s) => s.liveSessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const [apiKeyForm, setApiKeyForm] = useState({ provider: "anthropic", apiKey: "" });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"sessions" | "settings">("sessions");

  // Fetch saved sessions when sidebar opens
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

  const handleSwitchToLive = (session: LiveSessionInfo) => {
    if (session.id !== activeSessionId) {
      agent.setActiveSession(session.id);
    }
  };

  const handleSwitchToSaved = (session: SavedSessionInfo) => {
    // Check if this saved session is already open as a live session
    const alreadyLive = liveSessions.find((ls) => ls.sessionPath === session.path);
    if (alreadyLive) {
      agent.setActiveSession(alreadyLive.id);
    } else {
      agent.switchSession(session.path);
    }
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
                liveSessions={liveSessions}
                savedSessions={savedSessions}
                savedSessionsLoading={savedSessionsLoading}
                activeSessionId={activeSessionId}
                onSwitchLive={handleSwitchToLive}
                onSwitchSaved={handleSwitchToSaved}
                onCloseLive={(id) => agent.closeSession(id)}
                onNew={handleNewSession}
                onRefresh={() => agent.listSessions()}
                onRename={(path, name) => agent.renameSession(path, name)}
                onDelete={(path) => agent.deleteSession(path)}
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
  liveSessions,
  savedSessions,
  savedSessionsLoading,
  activeSessionId,
  onSwitchLive,
  onSwitchSaved,
  onCloseLive,
  onNew,
  onRefresh,
  onRename,
  onDelete,
}: {
  liveSessions: LiveSessionInfo[];
  savedSessions: SavedSessionInfo[];
  savedSessionsLoading: boolean;
  activeSessionId: string | null;
  onSwitchLive: (session: LiveSessionInfo) => void;
  onSwitchSaved: (session: SavedSessionInfo) => void;
  onCloseLive: (sessionId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  onRename: (sessionPath: string, name: string) => void;
  onDelete: (sessionPath: string) => void;
}) {
  // Filter saved sessions that are already open as live sessions
  const liveSessionPaths = new Set(liveSessions.map((ls) => ls.sessionPath).filter(Boolean));
  const nonLiveSavedSessions = savedSessions.filter((s) => !liveSessionPaths.has(s.path));

  return (
    <div className="p-3 space-y-4">
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

      {/* Live Sessions (open in this tab) */}
      {liveSessions.length > 0 && (
        <section>
          <div className="flex items-center gap-2 px-1 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Open Sessions
            </span>
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
              {liveSessions.length}
            </span>
          </div>
          <div className="space-y-1">
            {liveSessions.map((session) => {
              const isCurrent = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                    isCurrent
                      ? "bg-violet-500/10 border border-violet-500/20"
                      : "hover:bg-zinc-800/70 border border-transparent"
                  }`}
                >
                  <button
                    onClick={() => onSwitchLive(session)}
                    className="flex flex-1 flex-col gap-0.5 text-left min-w-0"
                  >
                    <div className="flex items-center gap-2">
                      {/* Streaming indicator */}
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          session.isStreaming
                            ? "bg-violet-500 animate-pulse"
                            : isCurrent
                              ? "bg-emerald-500"
                              : "bg-zinc-600"
                        }`}
                      />
                      <span
                        className={`truncate text-sm font-medium ${
                          isCurrent ? "text-violet-300" : "text-zinc-300"
                        }`}
                      >
                        {session.model?.name ?? "No model"}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600 pl-4 truncate">
                      {shortenCwd(session.cwd)}
                      {" · "}
                      {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
                      {session.isStreaming ? " · streaming" : ""}
                    </span>
                  </button>

                  {/* Close button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseLive(session.id);
                    }}
                    className="shrink-0 rounded p-1 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 hover:bg-zinc-700 transition-all"
                    title="Close session"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Saved Sessions from disk */}
      <section>
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Saved Sessions
          </span>
          <button
            onClick={onRefresh}
            disabled={savedSessionsLoading}
            className="text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <svg
              className={`h-3.5 w-3.5 ${savedSessionsLoading ? "animate-spin" : ""}`}
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

        {savedSessionsLoading && nonLiveSavedSessions.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <span className="text-xs text-zinc-600">Loading sessions...</span>
          </div>
        )}

        {!savedSessionsLoading && nonLiveSavedSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-xs text-zinc-600">No other saved sessions</span>
          </div>
        )}

        <div className="space-y-1">
          {nonLiveSavedSessions.map((session) => (
            <SavedSessionItem
              key={session.path}
              session={session}
              onSwitch={onSwitchSaved}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Saved Session Item (with rename/delete) ──────────────────────────

function SavedSessionItem({
  session,
  onSwitch,
  onRename,
  onDelete,
}: {
  session: SavedSessionInfo;
  onSwitch: (session: SavedSessionInfo) => void;
  onRename: (sessionPath: string, name: string) => void;
  onDelete: (sessionPath: string) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const modified = new Date(session.modified);
  const timeStr = formatRelativeTime(modified);
  const displayName = session.name || truncateMessage(session.firstMessage) || "Untitled";

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setIsRenaming(true);
    // Focus after render
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const confirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session.path, trimmed);
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setIsRenaming(false);
  };

  const startDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingDelete(true);
  };

  const confirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(session.path);
    setIsConfirmingDelete(false);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingDelete(false);
  };

  if (isConfirmingDelete) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2.5">
        <span className="text-xs text-red-400">Delete this session? This cannot be undone.</span>
        <div className="flex items-center gap-2">
          <button
            onClick={confirmDelete}
            className="rounded px-2.5 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={cancelDelete}
            className="rounded px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full items-center gap-1 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-800/70 border border-transparent transition-colors">
      <button
        onClick={() => onSwitch(session)}
        className="flex flex-1 flex-col gap-1 min-w-0"
      >
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-violet-500/50 bg-zinc-800 px-1.5 py-0.5 text-sm text-zinc-200 outline-none"
            placeholder="Session name"
          />
        ) : (
          <span className="truncate text-sm font-medium text-zinc-300 group-hover:text-zinc-100">
            {displayName}
          </span>
        )}
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

      {/* Action buttons (visible on hover) */}
      {!isRenaming && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Rename button */}
          <button
            onClick={startRename}
            className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-all"
            title="Rename session"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {/* Delete button */}
          <button
            onClick={startDelete}
            className="rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-all"
            title="Delete session"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
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

function shortenCwd(cwd: string): string {
  if (!cwd) return "";
  // Show just the last 2 path segments
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return "…/" + parts.slice(-2).join("/");
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
