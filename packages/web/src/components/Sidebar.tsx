import { useChatStore } from "../stores/chatStore";
import { useState } from "react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  agent: {
    fetchAuthStatus: () => Promise<void>;
  };
}

export function Sidebar({ open, onClose, agent }: SidebarProps) {
  const authStatus = useChatStore((s) => s.authStatus);
  const [apiKeyForm, setApiKeyForm] = useState({ provider: "anthropic", apiKey: "" });
  const [saving, setSaving] = useState(false);

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
            <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:text-zinc-200 lg:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
                  onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
                />
                <button
                  onClick={handleSaveKey}
                  disabled={saving || !apiKeyForm.apiKey.trim()}
                  className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "Saving..." : "Set API Key"}
                </button>
              </div>
            </section>

            {/* Info */}
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
        </div>
      </div>
    </>
  );
}
