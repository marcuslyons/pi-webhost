import { useCallback, useEffect, useRef, useState } from "react";

interface DirEntry {
  name: string;
  isDir: boolean;
}

interface AutocompleteState {
  entries: DirEntry[];
  resolved: string | null;
  loading: boolean;
  error: string | null;
  highlightedIndex: number;
  isOpen: boolean;
}

/**
 * Split a path into the parent directory and the current prefix being typed.
 * Examples:
 *   "/Users/mar"    → { parentDir: "/Users", prefix: "mar" }
 *   "~/github/"     → { parentDir: "~/github", prefix: "" }
 *   "~"             → { parentDir: "~", prefix: "" }
 *   "/foo"          → { parentDir: "/", prefix: "foo" }
 *   ""              → { parentDir: "", prefix: "" }
 */
function splitPath(input: string): { parentDir: string; prefix: string } {
  if (!input) return { parentDir: "", prefix: "" };

  // If the path ends with /, the parent is the whole path and prefix is empty
  if (input.endsWith("/")) {
    return { parentDir: input.slice(0, -1) || "/", prefix: "" };
  }

  const lastSlash = input.lastIndexOf("/");

  // No slash: could be just "~" or a bare name
  if (lastSlash === -1) {
    if (input === "~") return { parentDir: "~", prefix: "" };
    return { parentDir: ".", prefix: input };
  }

  // "~/" case or regular path
  const parentDir = input.slice(0, lastSlash) || "/";
  const prefix = input.slice(lastSlash + 1);
  return { parentDir, prefix };
}

export function useDirectoryAutocomplete(path: string) {
  const [state, setState] = useState<AutocompleteState>({
    entries: [],
    resolved: null,
    loading: false,
    error: null,
    highlightedIndex: -1,
    isOpen: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch entries when path changes (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!path.trim()) {
      setState((s) => ({ ...s, entries: [], resolved: null, error: null, loading: false, highlightedIndex: -1 }));
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const { parentDir, prefix } = splitPath(path);
      if (!parentDir && !prefix) return;

      const controller = new AbortController();
      abortRef.current = controller;

      setState((s) => ({ ...s, loading: true }));

      try {
        const params = new URLSearchParams({ path: parentDir || "." });
        if (prefix) params.set("prefix", prefix);

        const res = await fetch(`/api/list-dir?${params}`, { signal: controller.signal });
        const data = await res.json();

        if (!controller.signal.aborted) {
          setState((s) => ({
            ...s,
            entries: data.entries ?? [],
            resolved: data.resolved ?? null,
            error: data.error ?? null,
            loading: false,
            highlightedIndex: -1,
            isOpen: (data.entries?.length ?? 0) > 0,
          }));
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setState((s) => ({ ...s, entries: [], error: "Failed to fetch", loading: false }));
        }
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [path]);

  const setHighlightedIndex = useCallback((index: number) => {
    setState((s) => ({ ...s, highlightedIndex: index }));
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false, highlightedIndex: -1 }));
  }, []);

  const open = useCallback(() => {
    setState((s) => (s.entries.length > 0 ? { ...s, isOpen: true } : s));
  }, []);

  /**
   * Accept the highlighted entry (or the given entry).
   * Returns the new path string with the selected directory appended.
   */
  const accept = useCallback(
    (entry?: DirEntry): string | null => {
      const target = entry ?? (state.highlightedIndex >= 0 ? state.entries[state.highlightedIndex] : null);
      if (!target) return null;

      const { parentDir } = splitPath(path);
      const base = parentDir === "." ? "" : parentDir;
      const newPath = base ? `${base}/${target.name}/` : `${target.name}/`;
      setState((s) => ({ ...s, isOpen: false, highlightedIndex: -1 }));
      return newPath;
    },
    [path, state.entries, state.highlightedIndex],
  );

  const moveHighlight = useCallback(
    (direction: "up" | "down") => {
      setState((s) => {
        if (s.entries.length === 0) return s;
        let next: number;
        if (direction === "down") {
          next = s.highlightedIndex < s.entries.length - 1 ? s.highlightedIndex + 1 : 0;
        } else {
          next = s.highlightedIndex > 0 ? s.highlightedIndex - 1 : s.entries.length - 1;
        }
        return { ...s, highlightedIndex: next, isOpen: true };
      });
    },
    [],
  );

  return {
    ...state,
    setHighlightedIndex,
    close,
    open,
    accept,
    moveHighlight,
  };
}
