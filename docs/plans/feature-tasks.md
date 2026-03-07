# Feature Task List

> **Status: All tasks complete.** Every item below shipped in PRs #1–#9 and is merged to main.

Prioritized by lowest effort first. Each task is one PR's worth of work.
Excludes the Svelte 5 migration entirely.

Sources: `ROADMAP.md`, `AGENTS.md`, `docs/prds/001-telemetry-autocomplete-persistence.md`

---

## 1. Session Naming & Deletion

**Effort: Low** · **Impact: Medium** · **Source: Exploring**

Rename sessions from the sidebar, delete old ones from disk. Currently sessions can only be closed (removed from memory) but not deleted from `~/.pi/agent/sessions/`, and they have no user-facing name.

### Task 1.1 — Add `rename_session` and `delete_session` WS commands

**Files:**
- `packages/server/src/ws/handler.ts` — add to `ClientCommand` union, add cases in `handleCommand()`
- `packages/server/src/agent/manager.ts` — add `renameSession(id, name)` and `deletePersistedSession(sessionPath)` methods

**Inputs:** Pi's `SessionManager` API for session file manipulation. Session files are JSONL in `~/.pi/agent/sessions/`.

**Implementation:**
- `rename_session { sessionId, name }` — calls a method on `AgentSession` or writes a metadata sidecar. Check if Pi SDK supports session naming natively (look at `session.name` or `SessionManager` API). If not, store names in a local JSON file (`~/.pi/agent/pi-webhost/session-names.json`).
- `delete_session { sessionPath }` — removes the JSONL file from disk via `fs.unlink`. Must NOT delete sessions that are currently live in `AgentManager.sessions`.

**Acceptance criteria:**
- `rename_session` succeeds and the name persists across server restarts
- `delete_session` removes the file from disk and the session no longer appears in `list_persisted_sessions`
- Attempting to delete a live session returns an error
- `npm run typecheck` passes

### Task 1.2 — Sidebar UI for rename and delete

**Files:**
- `packages/web/src/components/Sidebar.tsx` — `SessionsTab` component, saved session list items
- `packages/web/src/hooks/useAgent.ts` — add `renameSession()` and `deleteSession()` to the hook's public API and `send()` calls
- `packages/web/src/lib/types.ts` — add `name` field to `SavedSessionInfo` if not already present

**Implementation:**
- Each saved session item in the sidebar gets a context menu (right-click or kebab icon) with "Rename" and "Delete" actions.
- Rename: inline text input that replaces the session title, Enter to confirm, Escape to cancel. Sends `rename_session` WS command.
- Delete: confirmation prompt ("Delete this session? This cannot be undone."), then sends `delete_session` WS command. On success, remove from `savedSessions` in the store.
- After delete, call `listSessions()` to refresh the list.

**Acceptance criteria:**
- Can rename a saved session from the sidebar; new name persists after page reload
- Can delete a saved session; file removed from disk, list updates
- Cannot delete a session that's currently open (error shown)
- Keyboard accessible (Enter/Escape for rename, focus management)

---

## 2. Session Telemetry — Footer Bar

**Effort: Low-Medium** · **Impact: High** · **Source: Up Next (PRD Feature 1)**

Token counts, cost, and context window usage displayed persistently. The Pi SDK already exposes everything via `session.getSessionStats()` and `session.getContextUsage()`.

### Task 2.1 — Server: emit `stats_update` events after each turn

**Files:**
- `packages/server/src/ws/handler.ts` — modify `setupEventForwarding()` to detect `turn_end` / `agent_end` events and emit stats
- `packages/server/src/agent/manager.ts` — no changes needed (stats come from `AgentSession`)

**Implementation:**
- In `setupEventForwarding()`, when the subscription callback receives a `turn_end` or `agent_end` event, call `managed.session.getSessionStats()` and `managed.session.getContextUsage()`, then `send()` a `stats_update` event:
  ```json
  {
    "type": "stats_update",
    "sessionId": "...",
    "stats": { "tokens": {...}, "cost": 0.42, ... },
    "context": { "tokens": 12000, "contextWindow": 200000, "percent": 6.0 }
  }
  ```
- Also include stats in the `session_created` and `session_switched` response payloads (initial values).
- Add a `get_stats` command as a fallback for on-demand polling (client sends `{ type: "get_stats", sessionId }`, server responds with current stats).

**Acceptance criteria:**
- After every completed turn, a `stats_update` event is sent to the client with current stats
- `session_created` and `session_switched` include initial stats (zeros for new sessions, populated for resumed ones)
- `get_stats` command returns current stats on demand
- `npm run typecheck` passes

### Task 2.2 — Client: types, store, and event handling for telemetry

**Files:**
- `packages/web/src/lib/types.ts` — add `SessionStats` and `ContextUsage` interfaces
- `packages/web/src/stores/chatStore.ts` — add per-session stats storage
- `packages/web/src/hooks/useAgent.ts` — handle `stats_update` events in `handleServerMessage()` / `handlePiEvent()`

**Implementation:**
- Add types:
  ```typescript
  interface SessionStats {
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalMessages: number;
  }
  interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  }
  ```
- In `SessionData` (or a parallel `statsMap: Map<string, { stats: SessionStats; context: ContextUsage }>`), store per-session stats.
- In `handleServerMessage()`, route `stats_update` events to the store by `sessionId`.
- Extract stats from `session_created` and `session_switched` payloads if present.

**Acceptance criteria:**
- `stats_update` events populate per-session stats in the store
- Stats for the active session are readable via `useChatStore`
- Switching sessions shows the correct stats for the newly active session
- Types compile cleanly

### Task 2.3 — Client: Footer component with stats display

**Files:**
- `packages/web/src/components/Footer.tsx` — new file
- `packages/web/src/App.tsx` — render `Footer` below the `Editor`
- Tailwind classes (no new CSS files)

**Implementation:**
- New `Footer.tsx` component. Reads stats from `useChatStore` for the active session.
- Layout: single horizontal bar, zinc-900 background, border-t border-zinc-800.
- Content: `↑12.4k ↓3.2k R8.1k W2.0k $0.42 · 48% of 200k`
  - Token counts abbreviated (e.g., 12400 → `12.4k`)
  - Cost formatted as `$X.XX` (or `$X.XXX` if < $0.01)
  - Context percentage with color-coded bar: `bg-emerald-500` (<60%), `bg-amber-500` (60-80%), `bg-red-500` (>80%)
  - Progress bar is a simple `<div>` with percentage width
- When no session is active or stats are unavailable, show a dimmed placeholder or hide the bar.
- Must be responsive: on narrow screens, abbreviate or stack.

**Acceptance criteria:**
- Footer visible below the editor at all times when a session is active
- Stats update in real-time after each turn (no manual refresh)
- Context bar color changes at 60% and 80% thresholds
- Clean appearance with the existing zinc/violet design system
- Footer hidden or shows "—" when no session is active

### Task 2.4 — Per-message cost labels on assistant messages

**Files:**
- `packages/web/src/components/Message.tsx` — add cost label to the `assistant` case
- `packages/web/src/lib/types.ts` — add optional `usage` field to `ChatMessage`
- `packages/web/src/hooks/useAgent.ts` — extract `usage` from `message_end` events or assistant message data

**Implementation:**
- Pi's `AssistantMessage` includes a `usage` object with per-message token counts and cost breakdown. This data arrives in the `message_end` event (check the event payload — `event.message.usage`).
- In `handlePiEvent` for `message_end`, update the current assistant message with `usage` data.
- In `Message.tsx`, for `assistant` role messages, render a subtle label below the content: `↑1.2k ↓340 · $0.003` using `text-[10px] text-zinc-600`.
- Only show if usage data is present (it won't be for messages loaded from history unless Pi persists it).

**Acceptance criteria:**
- New assistant messages show per-message token/cost after the turn completes
- Label is visually subtle, doesn't interfere with content readability
- Messages without usage data (e.g., loaded from history) show no label
- No layout shift when the label appears (reserve space or use absolute positioning)

### Task 2.5 — Sidebar: per-session cost in live sessions list

**Files:**
- `packages/web/src/components/Sidebar.tsx` — `SessionsTab`, live session items
- `packages/web/src/stores/chatStore.ts` — expose per-session stats for sidebar consumption
- `packages/server/src/ws/handler.ts` — include cost in `live_sessions_update` payload

**Implementation:**
- Modify `sendLiveSessionsList()` in `handler.ts` to include `cost` from `session.getSessionStats().cost` for each live session.
- Add `cost?: number` to `LiveSessionInfo` in `types.ts`.
- In `Sidebar.tsx`, show cost next to each live session: `$0.42` in `text-[10px] text-zinc-500`.
- Update `setLiveSessions` in the store if needed.

**Acceptance criteria:**
- Each live session in the sidebar shows its cumulative cost
- Cost updates when `live_sessions_update` fires (after each turn)
- Cost is `$0.00` for new sessions with no turns

---

## 3. Directory Autocomplete

**Effort: Low-Medium** · **Impact: Medium** · **Source: Up Next (PRD Feature 2)**

Predictive path completion in the New Session dialog. Server lists directories as the user types.

### Task 3.1 — Server: `GET /api/list-dir` endpoint

**Files:**
- `packages/server/src/api/routes.ts` — add new route

**Implementation:**
- New endpoint: `GET /api/list-dir?path=/foo/bar&prefix=src`
- Uses `fs.readdir(resolvedPath, { withFileTypes: true })` to list directory contents.
- Filters to directories only (`dirent.isDirectory()`).
- Supports `~` expansion via `os.homedir()`.
- If `prefix` is provided, filters entries to those starting with `prefix` (case-insensitive).
- Sorts alphabetically, directories with `.` prefix sorted last unless the prefix starts with `.`.
- Limits results to 50 entries.
- Returns:
  ```json
  {
    "entries": [
      { "name": "src", "isDir": true },
      { "name": "scripts", "isDir": true }
    ],
    "resolved": "/foo/bar"
  }
  ```
- Error handling: `EACCES` → `{ entries: [], error: "Permission denied" }`, `ENOENT` → `{ entries: [], error: "Directory not found" }`.

**Acceptance criteria:**
- `GET /api/list-dir?path=~` returns home directory contents (dirs only)
- `GET /api/list-dir?path=~/github&prefix=mar` returns matching subdirectories
- Dotfiles only appear when prefix starts with `.`
- Permission errors return empty entries with an error message, not a 500
- Max 50 entries returned
- `npm run typecheck` passes

### Task 3.2 — Client: autocomplete dropdown in NewSessionDialog

**Files:**
- `packages/web/src/components/NewSessionDialog.tsx` — replace plain text input with autocomplete
- New helper: `packages/web/src/hooks/useDirectoryAutocomplete.ts` (optional, can be inline)

**Implementation:**
- Parse the current input value into `{ parentDir, prefix }`. E.g., `/Users/mar` → `{ parentDir: "/Users", prefix: "mar" }`. `~/github/` → `{ parentDir: "~/github", prefix: "" }`.
- On every keystroke (debounced ~150ms), fetch `GET /api/list-dir?path={parentDir}&prefix={prefix}`.
- Render results in a positioned `<ul>` dropdown below the input.
  - Each item shows a folder icon (📁 or SVG) and the directory name.
  - Dotfiles dimmed unless prefix starts with `.`.
- Track `highlightedIndex` state for keyboard nav.
- Keyboard: ↑/↓ navigate, Tab or Enter accepts highlighted (appends to path and re-fetches), Escape closes dropdown.
- When input is empty or focused with no text, show "Recent" section at top (existing `recentDirs`).
- Selecting a suggestion updates the input to `parentDir/selectedName/` and triggers a new fetch.
- Existing validation (checkmark/X icon) continues to work alongside autocomplete.

**Acceptance criteria:**
- Typing a partial path shows matching directory suggestions
- Arrow keys navigate, Tab/Enter accepts, Escape closes
- Selecting a suggestion appends it and refreshes for next segment
- Recent directories appear when input is empty
- Path validation (green check / red X) still works
- No flicker or race conditions from rapid typing (debounce + abort previous fetch)
- Works with `~` paths

---

## 4. Image Paste & Drag-to-Attach

**Effort: Low-Medium** · **Impact: Medium** · **Source: Exploring**

Pi supports `ImageContent` in prompts. The editor should support paste and drag-to-attach images.

### Task 4.1 — Editor: paste and drag handlers for images

**Files:**
- `packages/web/src/components/Editor.tsx` — add `onPaste` and `onDrop`/`onDragOver` handlers
- `packages/web/src/stores/chatStore.ts` — add `pendingImages: Array<{ data: string; mimeType: string }>` to store (or local state in Editor)
- `packages/web/src/hooks/useAgent.ts` — modify `sendPrompt()` to accept and forward images

**Implementation:**
- `onPaste`: check `event.clipboardData.items` for `image/*` types. Read as base64 via `FileReader.readAsDataURL()`. Store in component state or chatStore as `{ data: base64String, mimeType: "image/png" }`.
- `onDrop`: similar, read `event.dataTransfer.files` for image files.
- Show image thumbnails as pills/chips below the editor input (small preview, X to remove).
- Modify `sendPrompt` to include `images` array in the WS `prompt` command (already supported — see `ClientCommand` prompt type in `handler.ts` which accepts `images?: Array<{ data: string; mimeType: string }>`).
- Clear pending images after send.
- Limit: max 5 images, max 10MB per image (show error otherwise).
- Supported types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.

**Acceptance criteria:**
- Pasting an image from clipboard shows a thumbnail preview below the editor
- Dragging an image file onto the editor shows a thumbnail preview
- Sending a prompt with images includes them in the WS command
- Images are cleared after sending
- Can remove a pending image before sending (X button)
- Invalid file types or oversized images show an error message
- Works with the existing `prompt` command — no server changes needed

---

## 5. Mobile-Optimized Layout

**Effort: Medium** · **Impact: Medium** · **Source: Exploring**

Responsive design for phone-sized screens. The sidebar is the biggest problem.

### Task 5.1 — Responsive layout: sidebar, chat, editor

**Files:**
- `packages/web/src/App.tsx` — layout structure
- `packages/web/src/components/Sidebar.tsx` — already has `lg:hidden` backdrop, needs polish
- `packages/web/src/components/Chat.tsx` — message width constraints
- `packages/web/src/components/Editor.tsx` — input sizing
- `packages/web/src/components/Header.tsx` — compact header for mobile

**Implementation:**
- Sidebar: already overlays on mobile (`lg:hidden` backdrop). Ensure it's full-width on `<sm` screens, touch-friendly tap targets (min 44px), swipe-to-close if feasible (or just tap backdrop).
- Chat area: messages use `max-w-[80%]`/`max-w-[85%]` which is fine. Reduce padding on `<sm`. Tool results should truncate more aggressively on small screens.
- Editor: full-width on mobile. Send button should be a visible icon button, not hidden. Reduce font size slightly.
- Header: model selector and thinking level should collapse into a single dropdown or bottom sheet on mobile. Show hamburger → sidebar, plus a compact model indicator.
- Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) throughout. No new breakpoints needed.
- Test at 375px width (iPhone SE) and 390px (iPhone 14).

**Acceptance criteria:**
- App is fully usable at 375px viewport width
- Sidebar opens/closes smoothly on mobile
- Chat messages are readable without horizontal scroll
- Editor input and send button are touch-friendly
- Model/thinking controls accessible on mobile (even if behind a menu)
- No horizontal overflow on any screen size

---

## 6. Search Within Sessions

**Effort: Medium** · **Impact: Medium** · **Source: Exploring**

Full-text search across message history within a session.

### Task 6.1 — Client-side search within the active session

**Files:**
- `packages/web/src/components/Chat.tsx` — add search bar (toggle with Cmd+F or search icon)
- `packages/web/src/components/Message.tsx` — highlight matching text
- `packages/web/src/stores/chatStore.ts` — add `searchQuery` and `searchResults` state

**Implementation:**
- Search bar: appears at the top of the chat area (or as an overlay) when triggered. Input with debounced filtering (~200ms).
- Searches all `ChatMessage.content` in the active session's message array. Case-insensitive substring match.
- Results: highlight matching messages (add a faint highlight border/background to matching `Message` components). Scroll to first match. Show "N of M matches" counter.
- Navigation: ↑/↓ arrows or dedicated prev/next buttons to jump between matches.
- Cmd+F (or Ctrl+F on non-Mac) opens the search bar. Escape closes it.
- Search only operates on the currently displayed session (client-side, no server needed).
- For cross-session search, that would require a server endpoint and is out of scope here.

**Acceptance criteria:**
- Cmd+F opens a search bar in the chat area
- Typing a query highlights matching messages and shows match count
- Prev/Next navigation scrolls between matches
- Escape closes search and clears highlights
- Works on tool result content and assistant content
- No performance issues with 500+ messages (search is debounced)

---

## 7. Extension UI Protocol

**Effort: Medium-High** · **Impact: Medium** · **Source: Exploring**

Pi extensions can request user interaction. Surface extension UI prompts in the web UI.

### Task 7.1 — Research: audit Pi SDK extension events

**Files:**
- Pi SDK docs at `~/.volta/tools/image/packages/@mariozechner/pi-coding-agent/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- Pi extension docs at `docs/extensions.md` in the Pi package

**Implementation:**
- Read the Pi SDK and extension documentation to identify:
  - What events does the extension system emit? (`extension_ui_request`? `user_input_request`?)
  - What types of UI does it support? (confirm/deny, text input, selection?)
  - How does the terminal Pi harness handle these?
- Document findings in `docs/plans/extension-ui-research.md`.
- Identify the event types, payload shapes, and response mechanisms.

**Acceptance criteria:**
- Research document produced with: event types, payload schemas, response flow
- Recommendation on which UI types to support first
- Assessment of complexity and any SDK gaps

### Task 7.2 — Server: forward extension UI events, accept responses

**Files:**
- `packages/server/src/ws/handler.ts` — forward extension events, add `extension_response` command

**Implementation:**
- Based on Task 7.1 findings, forward extension UI events from the `AgentSession` subscription to the client (they likely already flow through as generic events, but may need special handling).
- Add a new WS command `extension_response { sessionId, requestId, response }` that sends the user's response back to the extension.
- The exact mechanism depends on the Pi SDK API (callback? promise? event?).

**Acceptance criteria:**
- Extension UI requests arrive at the client as typed events
- Client can send responses back via `extension_response`
- Extension receives the response and continues

### Task 7.3 — Client: extension UI overlay component

**Files:**
- `packages/web/src/components/ExtensionPrompt.tsx` — new file
- `packages/web/src/hooks/useAgent.ts` — handle extension events
- `packages/web/src/stores/chatStore.ts` — add `extensionPrompt` state

**Implementation:**
- When an extension UI event arrives, show a modal or inline prompt in the chat area.
- Support at minimum: confirmation (yes/no), text input, single-select from a list.
- User's response is sent back via the `extension_response` WS command.
- Queue multiple prompts if they arrive simultaneously (unlikely but possible).

**Acceptance criteria:**
- Extension prompts appear as UI overlays in the chat
- User can respond, and the extension continues
- Multiple concurrent prompts are queued and shown sequentially
- Prompt disappears after response is sent

---

## 8. Server-Owned Sessions

**Effort: High** · **Impact: Critical** · **Source: Up Next (PRD Feature 3)**

The foundational architecture change. Sessions persist independent of browser connections. Four phases, each a separate PR.

### Task 8.1 — Phase 1: Move session pool from per-connection to `AgentManager`

**Files:**
- `packages/server/src/agent/manager.ts` — becomes the single source of truth for all sessions
- `packages/server/src/ws/handler.ts` — `ConnectionState.sessions` removed; sessions looked up from `AgentManager`

**Implementation:**

Current state: `ConnectionState` owns a `Map<string, ManagedSession>` per WebSocket connection. On `onClose`, all sessions are destroyed.

Target state: `AgentManager.sessions` is THE pool. `ConnectionState` tracks only which session IDs this connection has subscribed to (a `Set<string>`), plus `activeSessionId`.

Changes to `handler.ts`:
- `ConnectionState.sessions` → `ConnectionState.subscribedSessionIds: Set<string>`
- `ConnectionState.unsubscribers` stays (tracks per-connection event forwarding subscriptions)
- `getTargetSession()` looks up sessions via `agentManager.getSession(id)` instead of `state.sessions.get(id)`
- `new_session`, `switch_session`: create/open via `agentManager`, add the ID to `subscribedSessionIds`, set up forwarding
- `close_session`: calls `agentManager.destroySession(id)`, removes from `subscribedSessionIds`
- `onClose`: **does NOT destroy sessions**. Unsubscribes event forwarding only. Sessions remain alive in `AgentManager`.

Changes to `manager.ts`:
- No structural changes needed — `AgentManager` already owns a `Map<string, ManagedSession>`. Just ensure `destroySession` is the only way sessions are removed.

Key behavioral change: closing the browser tab no longer kills sessions. They idle in `AgentManager` until explicitly closed or the server restarts.

**Acceptance criteria:**
- Closing a browser tab does NOT destroy active sessions
- Opening a new tab can see sessions from the previous tab (via `get_state` or a new list command)
- `close_session` still destroys a session
- Single-client workflows work identically to before (create, prompt, switch, close)
- No memory leaks: event forwarding subscriptions cleaned up on disconnect
- `npm run typecheck` passes

### Task 8.2 — Phase 2: Attach/detach protocol and multi-client support

**Files:**
- `packages/server/src/ws/handler.ts` — new commands: `attach_session`, `detach_session`, `list_active_sessions`
- `packages/server/src/agent/manager.ts` — add `subscribers: Map<string, Set<WSContext>>`, `attachClient()`, `detachClient()`, `broadcastEvent()`

**Implementation:**

New `AgentManager` members:
```typescript
subscribers: Map<string, Set<WSContext>>  // sessionId → connected clients

attachClient(sessionId: string, ws: WSContext): void
  // Add ws to subscribers set for this session
  // Set up event forwarding: session events → broadcast to all subscribers

detachClient(sessionId: string, ws: WSContext): void
  // Remove ws from subscribers set

detachAllForClient(ws: WSContext): void
  // Remove ws from all subscriber sets (called on onClose)

broadcastEvent(sessionId: string, event: any): void
  // Send to all WSContexts in subscribers.get(sessionId)
```

Event subscription changes:
- Currently, `setupEventForwarding()` in `handler.ts` subscribes per-connection. Move this to `AgentManager`: subscribe once when the session is created, broadcast to all attached clients.
- `AgentManager.createSession()` and `openSession()` set up the subscription internally.

New WS commands:
- `attach_session { sessionId }` — call `agentManager.attachClient(sessionId, ws)`. Returns current session info + message count.
- `detach_session { sessionId }` — call `agentManager.detachClient(sessionId, ws)`. Session keeps running.
- `list_active_sessions` — returns all sessions in the pool: `{ sessionId, cwd, model, isStreaming, messageCount }`.

`onClose` handler: calls `agentManager.detachAllForClient(ws)` instead of destroying sessions.

**Acceptance criteria:**
- Two browser tabs can attach to the same session
- Both tabs receive real-time streaming events
- One tab can send a prompt, the other sees the output
- Closing one tab does not affect the other's session
- `list_active_sessions` shows all server-side sessions
- `detach_session` stops events for that client without affecting others
- `npm run typecheck` passes

### Task 8.3 — Phase 3: Active session manifest for server restart recovery

**Files:**
- `packages/server/src/agent/manager.ts` — add `saveManifest()`, `loadManifest()`, call them on session lifecycle events
- `packages/server/src/index.ts` — call `loadManifest()` on startup

**Implementation:**

Manifest file: `~/.pi/agent/pi-webhost/active-sessions.json`
```json
{
  "sessions": [
    {
      "sessionPath": "/Users/marcus/.pi/agent/sessions/abc123.jsonl",
      "cwd": "/Users/marcus/project",
      "model": { "provider": "anthropic", "id": "claude-sonnet-4-20250514" },
      "thinkingLevel": "medium"
    }
  ]
}
```

`saveManifest()`:
- Serializes all sessions in the pool to the manifest.
- Called (debounced, ~1s) after `createSession`, `openSession`, `destroySession`, `setModel`.
- Writes atomically (write to `.tmp`, rename).

`loadManifest()`:
- Called once on server startup in `index.ts`.
- Reads the manifest, calls `openSession()` for each entry.
- Sets model and thinking level from the manifest.
- If a session file is missing or corrupt, log a warning and skip it.
- If the manifest file doesn't exist, start with an empty pool.

Edge case — interrupted streams:
- If a session was streaming when the server died, the JSONL file has the last completed turn. The session reopens at that state. No special handling needed beyond what `SessionManager.open()` already does.

**Acceptance criteria:**
- Restart the server → all previously active sessions are restored
- Clients reconnecting after restart can `list_active_sessions` and see restored sessions
- Adding/removing sessions updates the manifest
- Corrupt manifest file → server starts with empty pool (no crash)
- Missing session files referenced in manifest → skipped with a warning log

### Task 8.4 — Phase 4: Client reconnect flow with auto-reattach

**Files:**
- `packages/web/src/hooks/useAgent.ts` — reconnect logic, localStorage tracking
- `packages/web/src/stores/chatStore.ts` — no changes (existing `sessionDataMap` is the in-memory cache)
- `packages/web/src/lib/types.ts` — add types for reconnect state if needed

**Implementation:**

On WebSocket `onopen` (including reconnects):
1. Send `list_active_sessions`.
2. Compare response against `localStorage.getItem("pi-webhost-sessions")`:
   ```json
   {
     "attachedSessionIds": ["abc", "def"],
     "activeSessionId": "abc"
   }
   ```
3. For each session that exists on both client and server, send `attach_session`.
4. For attached sessions where the client's `sessionDataMap` is empty (new tab, cleared cache), send `get_messages { sessionId }` to reload history.
5. Restore `activeSessionId` from localStorage.

On session create/attach/close, update localStorage.

Multi-device scenario:
- New device (no localStorage) connects → `list_active_sessions` → user picks a session from a dialog or auto-attaches to all → `get_messages` to load history.
- Add a "Reconnecting…" overlay state during the reattach flow.

Interrupted stream detection:
- If a session was `isStreaming: true` in localStorage but `isStreaming: false` on the server with no new messages, show system message: "Session was interrupted. Showing last completed state."

**Acceptance criteria:**
- Close browser tab, reopen → sessions reattach automatically
- Open a second device → can see and attach to existing sessions
- Server restart → client reconnects, reattaches, loads message history
- Interrupted streams show an informative message
- localStorage is updated on every session lifecycle change
- No duplicate messages on reconnect (get_messages replaces, doesn't append)

---

## 9. HTTPS & Auth Gateway

**Effort: Medium-High** · **Impact: Medium** · **Source: Exploring**

For exposing pi-webhost beyond localhost (Tailscale, Cloudflare Tunnel, etc.).

### Task 9.1 — Server: optional basic auth middleware

**Files:**
- `packages/server/src/index.ts` — add auth middleware
- `packages/server/src/ws/handler.ts` — validate auth on WebSocket upgrade
- New: `packages/server/src/auth/middleware.ts`

**Implementation:**
- Read auth config from environment variables: `PI_WEBHOST_AUTH_USER`, `PI_WEBHOST_AUTH_PASSWORD`. If not set, no auth (current behavior).
- Hono middleware that checks `Authorization: Basic ...` header on all requests.
- For WebSocket upgrade requests, check the auth in the initial HTTP upgrade handshake (query param `?token=...` or cookie-based after initial login).
- Optional: support a bearer token (`PI_WEBHOST_AUTH_TOKEN`) as an alternative to basic auth.
- Return 401 with a `WWW-Authenticate: Basic` header on failed auth (triggers browser login dialog).

**Acceptance criteria:**
- With env vars unset: no auth required (backward compatible)
- With `PI_WEBHOST_AUTH_USER` + `PI_WEBHOST_AUTH_PASSWORD` set: browser prompts for credentials
- Correct credentials → full access to REST and WebSocket
- Incorrect credentials → 401 on REST, WebSocket upgrade rejected
- Works behind a reverse proxy (Tailscale, nginx, Cloudflare Tunnel)

### Task 9.2 — Server: optional TLS support

**Files:**
- `packages/server/src/index.ts` — conditional HTTPS server creation

**Implementation:**
- Read `PI_WEBHOST_TLS_CERT` and `PI_WEBHOST_TLS_KEY` environment variables (file paths to cert and key).
- If both are set, create an HTTPS server with `node:https.createServer()` and pass it to Hono's `serve()`.
- If not set, use HTTP as today.
- Log the protocol and URL on startup: `Listening on https://0.0.0.0:3141` or `http://...`.
- Document how to generate self-signed certs for local network use or use with Let's Encrypt.

**Acceptance criteria:**
- Without TLS env vars: HTTP as before
- With TLS env vars pointing to valid cert/key: HTTPS works, WebSocket upgrades to WSS
- Invalid cert/key paths → clear error message on startup
- Document the setup in README or a new `docs/https-setup.md`
