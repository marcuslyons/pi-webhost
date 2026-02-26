# Svelte/SvelteKit Migration Analysis

Evaluation of migrating pi-webhost's frontend from React + Vite + Zustand to Svelte or SvelteKit.

## Current Architecture

| Layer | Technology | Lines of Code |
|-------|-----------|---------------|
| Frontend framework | React 19 + Vite | ~2,200 LOC across 12 files |
| State management | Zustand | 206 LOC (chatStore.ts) |
| Styling | Tailwind CSS v4 | Utility classes + 100 LOC custom CSS |
| Markdown | react-markdown + remark-gfm | Used in Message.tsx |
| Server | Hono + Pi SDK | ~870 LOC (unchanged in either architecture) |
| Communication | WebSocket (raw) | useAgent.ts hook, 558 LOC |
| Bundle | 390 KB / 118 KB gzip | react-dom is the largest contributor |

## Where Svelte Would Genuinely Help

### 1. Reactivity model eliminates the store boilerplate

The current `chatStore.ts` (206 lines) exists purely because React doesn't have built-in fine-grained reactivity. Zustand is already lean, but look at what it's doing:

```typescript
// Current: Zustand store with explicit getters, setters, map cloning
addMessage: (sessionId, msg) =>
  set((state) => {
    const map = new Map(state.sessionDataMap);
    const data = map.get(sessionId) ?? emptySessionData();
    map.set(sessionId, { ...data, messages: [...data.messages, msg] });
    return { sessionDataMap: map };
  }),
```

In Svelte, this entire store collapses to reactive declarations:

```svelte
<script>
  let sessionDataMap = $state(new Map());
  let activeSessionId = $state(null);

  // Derived automatically
  let messages = $derived(
    sessionDataMap.get(activeSessionId)?.messages ?? []
  );
</script>
```

**Impact**: The 206-line store file mostly disappears. State lives where it's used. No `useChatStore((s) => s.activeIsStreaming)` selector pattern — just `{activeIsStreaming}`.

### 2. Less ceremony per component

Every React component in the codebase follows this pattern:

```tsx
export function Header({ onMenuClick, agent }: HeaderProps) {
  const activeModel = useChatStore((s) => s.activeModel);
  const thinkingLevel = useChatStore((s) => s.activeThinkingLevel);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);
  // ... 5 more selector calls
```

Svelte components don't need selector functions, prop interfaces, or `useCallback`/`useMemo` wrappers. The `useAgent.ts` hook (558 lines) wraps everything in `useCallback` to satisfy React's dependency rules — Svelte doesn't have this problem.

Rough estimate: **20-30% fewer lines** across components, with the savings concentrated in boilerplate rather than logic.

### 3. Bundle size

| | React (current) | Svelte (estimated) |
|---|---|---|
| Framework runtime | ~140 KB (react + react-dom) | ~5 KB (Svelte compiles away) |
| State library | ~8 KB (Zustand) | 0 (built-in) |
| Markdown | ~80 KB (react-markdown + unified) | ~80 KB (mdsvex or similar) |
| App code | ~160 KB | ~130 KB (fewer wrappers) |
| **Total JS** | **~390 KB (118 KB gzip)** | **~220 KB (~70 KB gzip)** |

The framework runtime difference is real but the practical impact is marginal. This is a self-hosted tool on a local network — nobody is loading it on 3G. The savings matter more if you care about principle than performance.

### 4. WebSocket handling would be cleaner

`useAgent.ts` is the largest file (558 lines). A significant chunk of it is React-specific:
- `useCallback` wrapping every function to prevent stale closures
- `useRef` for the WebSocket and timers because they can't live in render scope
- `useEffect` for connect/disconnect lifecycle
- Calling `useChatStore.getState()` instead of reading state directly (to avoid stale closure captures)

In Svelte, the WebSocket logic would be a plain module (`.svelte.ts`) with reactive state — no hooks, no dependency arrays, no ref indirection.

## Where Svelte Has No Advantage

### 1. The server is unchanged

The Hono backend, Pi SDK integration, WebSocket handler, and REST API (870 LOC) are framework-agnostic. None of this code changes in a migration.

### 2. Tailwind is identical

Every CSS class in every component stays exactly the same. The migration is copy-paste for the template portion of components.

### 3. The hard problems are domain problems

The complexity in this codebase is in the WebSocket protocol, multi-session state routing, event-to-message conversion, and Pi SDK integration. Svelte doesn't make any of that simpler — it just removes the React-specific friction around expressing it.

### 4. Markdown rendering

react-markdown works well. The Svelte equivalent (mdsvex, or a unified-based renderer) works equally well. No advantage either way.

## Where SvelteKit Specifically Adds Value (vs. plain Svelte + Vite)

### Worth considering

- **File-based routing**: Not relevant today (single page), but would matter if you add pages (session detail view, settings page, admin dashboard).
- **Form actions**: Could clean up the API key submission flow.
- **Server hooks**: Could replace the separate Hono server entirely — SvelteKit can serve the WebSocket and REST API. This would collapse the monorepo to a single package.

### Not worth it for this project

- **SSR**: This is an interactive app behind localhost. Server-side rendering adds complexity for zero benefit.
- **Load functions**: The data comes over WebSocket, not page loads.
- **Adapter ecosystem**: You're deploying to Node.js. `adapter-node` works but so does "run Hono directly."

### SvelteKit replacing Hono?

The most interesting SvelteKit angle: **collapsing the monorepo**. Currently:

```
packages/server/  → Hono + Pi SDK (870 LOC)
packages/web/     → React + Vite (2,200 LOC)
```

With SvelteKit:

```
src/
  routes/         → Pages
  lib/
    server/       → Pi SDK integration, WebSocket handler
    components/   → UI components
    stores/       → Reactive state
```

SvelteKit's server-side modules (`+server.ts`, hooks) could host the REST API. The WebSocket would need a custom server hook or a small adapter, since SvelteKit doesn't natively support WebSocket upgrade in all adapters — you'd likely still need a thin Hono/Express wrapper or use `adapter-node` with a custom server entry.

**Verdict**: This consolidation is appealing but the WebSocket requirement means you can't fully eliminate the custom server. The architecture simplification is partial.

## Migration Effort

| Task | Effort |
|------|--------|
| Rewrite 8 components to Svelte | ~3 hours (mostly mechanical) |
| Replace Zustand store with Svelte stores/runes | ~1 hour |
| Rewrite useAgent.ts as a Svelte module | ~2 hours |
| Replace react-markdown | ~30 min |
| Vite config / project setup | ~30 min |
| Testing and fixing edge cases | ~2 hours |
| **Total** | **~9 hours** |

The codebase is small enough that this is a single-day effort. The risk is low.

## Recommendation

**The migration is defensible but not urgent.**

The concrete benefits:
- ~30% less frontend code (mostly boilerplate elimination)
- ~40% smaller bundle
- Simpler mental model (no hooks rules, no stale closure bugs, no selector patterns)
- The WebSocket + state management layer — the most complex part — gets meaningfully simpler

The honest counterarguments:
- The current code works fine
- React's ecosystem is larger if you need libraries later
- If you (or contributors) are more fluent in React, that fluency has real value
- 2,200 lines is small enough that framework overhead is annoying but not crippling

**If you're going to do it, do it now** — while the codebase is 2,200 lines and not 22,000. The longer you wait, the less the ROI justifies the effort. If you're building this as a long-lived project and you prefer Svelte's model, migrating at this stage costs almost nothing.

If you decide to go SvelteKit: use it for routing and static asset serving, but keep the Hono server for WebSocket handling. Don't fight the WebSocket adapter situation.
