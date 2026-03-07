import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useDirectoryAutocomplete } from "../hooks/useDirectoryAutocomplete";

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateSession: (cwd: string) => void;
}

export function NewSessionDialog({ open, onClose, onCreateSession }: NewSessionDialogProps) {
  const serverCwd = useChatStore((s) => s.serverCwd);
  const serverHome = useChatStore((s) => s.serverHome);
  const savedSessions = useChatStore((s) => s.savedSessions);
  const [path, setPath] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    resolved?: string;
    error?: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocomplete = useDirectoryAutocomplete(path);

  // Extract unique cwds from saved sessions for quick picks
  const recentDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const s of savedSessions) {
      if (s.cwd) dirs.add(s.cwd);
    }
    // Remove the server cwd from recent since it's the default
    if (serverCwd) dirs.delete(serverCwd);
    return Array.from(dirs).slice(0, 8);
  }, [savedSessions, serverCwd]);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setPath(serverCwd ?? "");
      setValidationResult(null);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, serverCwd]);

  // Validate path on change (debounced)
  useEffect(() => {
    if (!path.trim()) {
      setValidationResult(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
        const res = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        setValidationResult(data);
      } catch {
        setValidationResult({ valid: false, error: "Failed to validate" });
      } finally {
        setValidating(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [path]);

  const handleCreate = useCallback(() => {
    const target = validationResult?.resolved ?? (path.trim() || serverCwd);
    if (target) {
      onCreateSession(target);
      onClose();
    }
  }, [path, validationResult, serverCwd, onCreateSession, onClose]);

  const shortenPath = (p: string) => {
    if (serverHome && p.startsWith(serverHome)) {
      return "~" + p.slice(serverHome.length);
    }
    return p;
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-zinc-200">New Session</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Directory input with autocomplete */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Working Directory
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (autocomplete.isOpen && autocomplete.entries.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        autocomplete.moveHighlight("down");
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        autocomplete.moveHighlight("up");
                        return;
                      }
                      if (e.key === "Tab" && autocomplete.highlightedIndex >= 0) {
                        e.preventDefault();
                        const newPath = autocomplete.accept();
                        if (newPath) setPath(newPath);
                        return;
                      }
                      if (e.key === "Enter" && autocomplete.highlightedIndex >= 0) {
                        e.preventDefault();
                        const newPath = autocomplete.accept();
                        if (newPath) setPath(newPath);
                        return;
                      }
                    }
                    if (e.key === "Enter" && (validationResult?.valid ?? !path.trim())) {
                      handleCreate();
                    }
                    if (e.key === "Escape") {
                      if (autocomplete.isOpen) {
                        autocomplete.close();
                      } else {
                        onClose();
                      }
                    }
                  }}
                  onFocus={() => autocomplete.open()}
                  onBlur={() => {
                    // Delay to allow click events on dropdown items
                    setTimeout(() => autocomplete.close(), 200);
                  }}
                  placeholder={serverCwd ?? "/path/to/project"}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 pr-8 font-mono text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500 transition-colors"
                  spellCheck={false}
                  autoComplete="off"
                />
                {/* Validation indicator */}
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {validating ? (
                    <svg className="h-4 w-4 animate-spin text-zinc-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : validationResult ? (
                    validationResult.valid ? (
                      <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )
                  ) : null}
                </div>

                {/* Autocomplete dropdown */}
                {autocomplete.isOpen && autocomplete.entries.length > 0 && (
                  <ul
                    ref={dropdownRef}
                    className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-lg"
                  >
                    {autocomplete.entries.map((entry, i) => (
                      <li key={entry.name}>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-mono transition-colors ${
                            i === autocomplete.highlightedIndex
                              ? "bg-violet-500/20 text-zinc-100"
                              : entry.name.startsWith(".")
                                ? "text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                                : "text-zinc-300 hover:bg-zinc-700/50"
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault(); // Prevent input blur
                            const newPath = autocomplete.accept(entry);
                            if (newPath) {
                              setPath(newPath);
                              inputRef.current?.focus();
                            }
                          }}
                          onMouseEnter={() => autocomplete.setHighlightedIndex(i)}
                        >
                          <svg className="h-3.5 w-3.5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          <span className="truncate">{entry.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* Validation message */}
              {validationResult && !validationResult.valid && !autocomplete.isOpen && (
                <p className="mt-1.5 text-xs text-red-400">{validationResult.error}</p>
              )}
              {validationResult?.valid && validationResult.resolved && validationResult.resolved !== path && !autocomplete.isOpen && (
                <p className="mt-1.5 text-xs text-zinc-500">
                  → {shortenPath(validationResult.resolved)}
                </p>
              )}
            </div>

            {/* Quick pick directories */}
            {recentDirs.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  Recent Directories
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {recentDirs.map((dir) => (
                    <button
                      key={dir}
                      onClick={() => setPath(dir)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-mono transition-colors ${
                        path === dir
                          ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                          : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                      }`}
                    >
                      {shortenPath(dir)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-3.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!!(path.trim() && validationResult && !validationResult.valid)}
              className="rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Session
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
