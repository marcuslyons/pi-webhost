# Svelte Migration Plan

Migration of `packages/web/` from React + Zustand to Svelte 5 (runes mode) + Vite. The server package (`packages/server/`) is untouched.

**Prerequisite reading**: `docs/svelte-migration-analysis.md`

---

## Architecture Decision

**Svelte 5 + Vite**, not SvelteKit. Rationale:
- Single-page app, no routing needed
- Data arrives over WebSocket, not page loads
- SSR adds complexity for zero benefit (localhost tool)
- Keep the Hono server as-is — it handles WebSocket upgrade, REST API, and static file serving in production
- The monorepo structure (`packages/server` + `packages/web`) stays the same

If routing needs emerge later (settings page, session detail views), SvelteKit can be adopted incrementally on top of this.

---

## Task Breakdown

Each task is self-contained. Complete them in order — later tasks depend on earlier ones. Every task ends with `npx tsc --noEmit` passing and `npx vite build` succeeding.

### Task 0: Project scaffolding

**Goal**: Replace the React Vite project with a Svelte Vite project. No component migration yet — just get an empty Svelte app rendering.

**Steps**:
1. Delete all files in `packages/web/src/` (we'll rewrite them)
2. Update `packages/web/package.json`:
   - Remove: `react`, `react-dom`, `react-markdown`, `remark-gfm`, `rehype-highlight`, `zustand`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
   - Add: `svelte` (^5), `@sveltejs/vite-plugin-svelte`, `svelte-check`
   - Add markdown library: `marked` (lightweight, no framework coupling) + `dompurify` for sanitization
   - Keep: `tailwindcss`, `@tailwindcss/vite`, `vite`, `typescript`
3. Update `packages/web/vite.config.ts`: replace `react()` plugin with `svelte()`, keep the proxy config and tailwindcss plugin identical
4. Update `packages/web/tsconfig.json`: Svelte doesn't need `jsx: "react-jsx"`. Follow svelte-check requirements.
5. Create `packages/web/svelte.config.js` (minimal, just `vitePreprocess`)
6. Update `packages/web/index.html`: keep as-is (the `<div id="root">` mount target stays)
7. Create minimal `packages/web/src/main.ts` that mounts an empty Svelte `App.svelte`
8. Create `packages/web/src/App.svelte` with just a "pi-webhost" heading
9. Keep `packages/web/src/index.css` — it's framework-agnostic (Tailwind imports + custom scrollbar/prose styles)
10. Move `packages/web/src/lib/types.ts` back in — these types are framework-agnostic, no changes needed
11. Add `typecheck` script: `svelte-check --tsconfig ./tsconfig.json`

**Verify**: `npm run dev -w packages/web` renders the placeholder. `svelte-check` passes. `vite build` produces output.

**Files created/modified**:
- `packages/web/package.json` (modified)
- `packages/web/vite.config.ts` (modified)
- `packages/web/tsconfig.json` (modified)
- `packages/web/svelte.config.js` (new)
- `packages/web/src/main.ts` (rewritten)
- `packages/web/src/App.svelte` (new, replaces App.tsx)
- `packages/web/src/lib/types.ts` (unchanged)
- `packages/web/src/index.css` (unchanged)

---

### Task 1: State management — agent store

**Goal**: Replace `chatStore.ts` (Zustand, 206 lines) with a Svelte runes-based store module.

**Source to port**: `packages/web/src/stores/chatStore.ts`

**Steps**:
1. Create `packages/web/src/lib/agent-state.svelte.ts`
2. Declare all state as module-level `$state()` runes:
   - `connected: boolean`
   - `activeSessionId: string | null`
   - `sessionDataMap: Map<string, SessionData>`
   - `liveSessions: LiveSessionInfo[]`
   - `activeModel: ModelInfo | null`
   - `activeThinkingLevel: ThinkingLevel`
   - `activeSessionPath: string | null`
   - `activeCwd: string | null`
   - `activeIsStreaming: boolean`
   - `serverCwd: string | null`
   - `serverHome: string | null`
   - `models: ModelInfo[]`
   - `savedSessions: SavedSessionInfo[]`
   - `savedSessionsLoading: boolean`
   - `authStatus: Record<string, { hasCredentials: boolean }>`
3. Add `$derived` for `activeMessages` (reads from `sessionDataMap` + `activeSessionId`)
4. Export mutation functions as plain functions (no `set()` wrapper needed):
   - `addMessage(sessionId, msg)` — push to the session's array directly
   - `updateMessage(sessionId, msgId, update)` — find and spread
   - `setMessages(sessionId, msgs)` — replace array
   - `ensureSessionData(sessionId)` — create entry if missing
   - `removeSessionData(sessionId)` — delete from map
   - etc.
5. Key difference from React: mutations are direct. `sessionDataMap.get(sid).messages.push(msg)` triggers reactivity because Svelte 5 tracks deep state. No Map cloning needed.

**Notes**:
- Svelte 5 runes (`$state`, `$derived`) work in `.svelte.ts` files at module scope
- This replaces the entire Zustand store. Components import state and functions directly.
- Types from `lib/types.ts` are reused as-is

**Verify**: File exists, exports compile, can be imported from a `.svelte` file.

---

### Task 2: WebSocket client — agent module

**Goal**: Replace `useAgent.ts` (React hook, 558 lines) with a plain Svelte module.

**Source to port**: `packages/web/src/hooks/useAgent.ts`

**Steps**:
1. Create `packages/web/src/lib/agent.svelte.ts`
2. Move all WebSocket logic out of the hook pattern:
   - Module-level `let ws: WebSocket | null` (no `useRef`)
   - Plain `connect()` function (no `useCallback`)
   - Plain `handleServerMessage()`, `handlePiEvent()` functions
   - All public API functions (`sendPrompt`, `abort`, `setModel`, etc.) as plain exports
3. The `connect()` function reads/writes state from `agent-state.svelte.ts` directly — no `useChatStore.getState()` indirection
4. Import and call state mutation functions directly:
   ```typescript
   import { addMessage, setActiveSessionId, ensureSessionData } from './agent-state.svelte';
   ```
5. Lifecycle: export `connect()` and `disconnect()` functions. Call them from `App.svelte`'s `onMount`/`onDestroy`.
6. Port `buildMessagesFromHistory()` and `formatToolArgs()` as-is — they're pure functions.

**Key simplifications vs React version**:
- No `useCallback` wrappers (all ~15 of them are eliminated)
- No `useRef` for WebSocket, timer, assistant ID
- No `useEffect` for lifecycle
- No `useChatStore.getState()` calls — read reactive state directly
- `reconnectTimer` is just a `let` variable
- `currentAssistantId` per session is already tracked in `SessionData`

**Verify**: Module exports `connect`, `disconnect`, `sendPrompt`, `abort`, `setModel`, `setThinkingLevel`, `newSession`, `listSessions`, `switchSession`, `setActiveSession`, `closeSession`, `fetchModels`, `fetchAuthStatus`, `fetchServerInfo`. Compiles clean.

---

### Task 3: Markdown rendering utility

**Goal**: Replace `react-markdown` with a framework-agnostic markdown renderer.

**Steps**:
1. Create `packages/web/src/lib/markdown.ts`
2. Use `marked` for parsing + `DOMPurify` for XSS sanitization
3. Export a function: `renderMarkdown(src: string): string` that returns sanitized HTML
4. Configure marked for GFM (tables, strikethrough, autolinks)
5. Components will use `{@html renderMarkdown(content)}` in Svelte templates

**Verify**: Renders basic markdown, code blocks, tables, links. Output is sanitized.

---

### Task 4: Message component

**Goal**: Port `Message.tsx` (147 lines) to `Message.svelte`.

**Source to port**: `packages/web/src/components/Message.tsx`

**Steps**:
1. Create `packages/web/src/components/Message.svelte`
2. Accept `message: ChatMessage` as a prop
3. Port the role-based rendering (`user`, `assistant`, `tool_call`, `tool_result`, `system`)
4. Replace `<ReactMarkdown>` with `{@html renderMarkdown(message.content)}`
5. Collapsible thinking blocks and tool results: use local `let expanded = $state(false)` instead of `useState`
6. All Tailwind classes are copy-paste identical

**Verify**: Renders all message types. Thinking toggle works. Tool result collapse works.

---

### Task 5: Editor component

**Goal**: Port `Editor.tsx` (106 lines) to `Editor.svelte`.

**Source to port**: `packages/web/src/components/Editor.tsx`

**Steps**:
1. Create `packages/web/src/components/Editor.svelte`
2. Accept `onSend` and `onAbort` as props (use Svelte's typed props)
3. Replace `useState`/`useRef`/`useCallback` with:
   - `let input = $state("")`
   - `let textareaEl: HTMLTextAreaElement` (bind:this)
4. Textarea auto-resize: `on:input` handler, no `useCallback`
5. Keyboard handling: `on:keydown` with same logic
6. Read `activeIsStreaming` from `agent-state.svelte.ts` directly (no store selector)

**Verify**: Text input works. Enter sends. Shift+Enter for newline. Escape aborts during streaming. Textarea auto-grows.

---

### Task 6: Chat component

**Goal**: Port `Chat.tsx` (103 lines) to `Chat.svelte`.

**Source to port**: `packages/web/src/components/Chat.tsx`

**Steps**:
1. Create `packages/web/src/components/Chat.svelte`
2. Import `activeMessages` (derived) from `agent-state.svelte.ts`
3. Auto-scroll: use `$effect` watching `activeMessages.length` instead of `useEffect`
4. `bind:this={scrollEl}` instead of `useRef`
5. Render `{#each activeMessages as msg (msg.id)}` → `<Message {msg} />`
6. Empty state component inline or extracted
7. Suggestion buttons: use `bind:this` on textarea from Editor (or dispatch a custom event). Simpler: accept an `onSuggest` prop and let App wire it.

**Verify**: Messages render. Auto-scroll works. Empty state shows. Suggestions fill the editor.

---

### Task 7: Header component

**Goal**: Port `Header.tsx` (159 lines) to `Header.svelte`.

**Source to port**: `packages/web/src/components/Header.tsx`

**Steps**:
1. Create `packages/web/src/components/Header.svelte`
2. Read state directly from `agent-state.svelte.ts`: `activeModel`, `activeThinkingLevel`, `activeIsStreaming`, `activeCwd`, `serverHome`, `models`, `connected`, `liveSessions`, `activeSessionId`
3. Import action functions from `agent.svelte.ts`: `setModel`, `setThinkingLevel`, `abort`, `newSession`
4. No prop drilling for agent actions — import directly
5. Port the `NewSessionDialog` trigger (see Task 8)
6. Background streaming badge: `$derived` from `liveSessions.filter(...)`
7. cwd display with `shortenPath` helper

**Verify**: Model selector works. Thinking level works. Status indicator. Abort button. New session opens dialog. cwd shown.

---

### Task 8: NewSessionDialog component

**Goal**: Port `NewSessionDialog.tsx` (209 lines) to `NewSessionDialog.svelte`.

**Source to port**: `packages/web/src/components/NewSessionDialog.tsx`

**Steps**:
1. Create `packages/web/src/components/NewSessionDialog.svelte`
2. Props: `open: boolean`, events: `on:close`, `on:create`
3. Replace `useState` with `$state`, `useRef` with `bind:this`, `useEffect` with `$effect`
4. Debounced validation: `$effect` with a timeout on `path` changes
5. Recent directories: `$derived` from `savedSessions`
6. Focus management: `$effect` triggered by `open`

**Verify**: Opens/closes. Path input validates. Recent dirs show. Enter creates. Escape cancels.

---

### Task 9: Sidebar component

**Goal**: Port `Sidebar.tsx` (485 lines) to `Sidebar.svelte`. Consider splitting into sub-components.

**Source to port**: `packages/web/src/components/Sidebar.tsx`

**Steps**:
1. Create `packages/web/src/components/Sidebar.svelte`
2. Optionally split: `SessionsTab.svelte`, `SettingsTab.svelte` (the React version has these as inline functions — Svelte components are cheap, splitting is natural)
3. Read state from `agent-state.svelte.ts` directly
4. Import actions from `agent.svelte.ts` directly — no prop threading
5. Tab switching: `let activeTab = $state<"sessions" | "settings">("sessions")`
6. API key form: local `$state`
7. Fetch sessions on open: `$effect` watching `open` prop
8. Port `truncateMessage`, `formatRelativeTime`, `shortenCwd` helpers (pure functions, copy-paste)

**Verify**: Tabs switch. Live sessions show with status. Saved sessions load. Session switching works. Close button works. Auth status displays. API key form submits.

---

### Task 10: App shell + wiring

**Goal**: Wire everything together in `App.svelte`. This is where lifecycle and top-level layout live.

**Steps**:
1. Update `packages/web/src/App.svelte`:
   - Import all components
   - Call `connect()` in `onMount`, `disconnect()` in `onDestroy`
   - Sidebar open/close: `let sidebarOpen = $state(false)`
   - Read `connected` from `agent-state.svelte.ts`
   - Layout: same flex structure as current `App.tsx`
2. Update `packages/web/src/main.ts` to mount `App.svelte` on `#root`
3. Verify the full data flow:
   - Type a prompt → WebSocket → server → events → store → Chat renders
   - Switch model → header select → WebSocket → response → store → header updates
   - New session dialog → create → WebSocket → session_created → store → sidebar updates
   - Switch session → sidebar click → WebSocket → session_switched → store → chat renders history

**Verify**: Full end-to-end flow works. All features from the React version are functional.

---

### Task 11: Cleanup and verification

**Goal**: Final pass — remove React artifacts, verify build, check types.

**Steps**:
1. Confirm no React imports remain anywhere in `packages/web/`
2. Run `svelte-check` — zero errors
3. Run `vite build` — verify bundle size (target: under 250 KB uncompressed JS)
4. Run both `npm run dev -w packages/server` and `npm run dev -w packages/web` — full smoke test
5. Test in browser:
   - Send a prompt, verify streaming works
   - Switch models, change thinking level
   - Open sidebar, check session list
   - Create new session with custom cwd
   - Switch between sessions, verify background streaming
   - Close a session
   - Check auth status, set an API key
6. Update `packages/web/package.json` scripts if needed
7. Delete any leftover React files if not already removed in Task 0
8. Update root `README.md` to reflect Svelte (dependencies section, any React-specific mentions)

**Verify**: `npm run typecheck` passes for both packages. `npm run build` succeeds. Manual smoke test passes all items above.

---

## Files: React → Svelte Mapping

| React file | Svelte replacement | Notes |
|---|---|---|
| `src/main.tsx` | `src/main.ts` | Mount point |
| `src/App.tsx` | `src/App.svelte` | Shell + lifecycle |
| `src/stores/chatStore.ts` | `src/lib/agent-state.svelte.ts` | Runes replace Zustand |
| `src/hooks/useAgent.ts` | `src/lib/agent.svelte.ts` | Plain module replaces hook |
| `src/lib/types.ts` | `src/lib/types.ts` | Unchanged |
| `src/index.css` | `src/index.css` | Unchanged |
| `src/components/Chat.tsx` | `src/components/Chat.svelte` | |
| `src/components/Editor.tsx` | `src/components/Editor.svelte` | |
| `src/components/Header.tsx` | `src/components/Header.svelte` | |
| `src/components/Message.tsx` | `src/components/Message.svelte` | |
| `src/components/NewSessionDialog.tsx` | `src/components/NewSessionDialog.svelte` | |
| `src/components/Sidebar.tsx` | `src/components/Sidebar.svelte` | Maybe split into sub-components |
| — | `src/lib/markdown.ts` | New: replaces react-markdown |

## What Does NOT Change

- `packages/server/` — completely untouched
- `packages/web/index.html` — same mount point
- `packages/web/public/` — same static assets
- `packages/web/src/lib/types.ts` — same TypeScript interfaces
- `packages/web/src/index.css` — same Tailwind + custom CSS
- `packages/web/vite.config.ts` — only the plugin changes (react → svelte)
- Root `package.json`, `tsconfig.base.json` — unchanged
- WebSocket protocol — identical on the wire
- REST API — identical
