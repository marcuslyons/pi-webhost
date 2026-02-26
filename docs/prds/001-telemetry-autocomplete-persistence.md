# PRD-001: Session Telemetry, Directory Autocomplete, Session Persistence

Three features that bring pi-webhost closer to the Pi terminal experience and improve usability for multi-session workflows.

---

## Feature 1: Session Telemetry Display

### Problem

The Pi terminal harness shows a rich footer with token counts, cache stats, cost, and context window usage. pi-webhost surfaces none of this. When running long sessions or expensive models, the user has no visibility into resource consumption or how close they are to context limits.

### What Pi Exposes

The SDK provides everything we need:

**`session.getSessionStats(): SessionStats`**
```typescript
{
  tokens: { input, output, cacheRead, cacheWrite, total },
  cost: number,             // cumulative USD
  userMessages: number,
  assistantMessages: number,
  toolCalls: number,
  toolResults: number,
  totalMessages: number,
}
```

**`session.getContextUsage(): ContextUsage | undefined`**
```typescript
{
  tokens: number | null,       // estimated context tokens (null after compaction)
  contextWindow: number,       // model's context window size
  percent: number | null,      // tokens / contextWindow as percentage
}
```

**Per-message usage** (on every `AssistantMessage`):
```typescript
{
  usage: {
    input, output, cacheRead, cacheWrite, totalTokens,
    cost: { input, output, cacheRead, cacheWrite, total }
  }
}
```

### Requirements

**R1: Footer bar** — persistent bar below the editor showing session-level stats for the active session:
- Token counts: `↑ 12.4k ↓ 3.2k` (input/output, abbreviated)
- Cache: `R 8.1k W 2.0k` (cache read/write)
- Cost: `$0.42`
- Context: `48% of 200k` with a visual progress bar. Color shifts: green (<60%), yellow (60-80%), red (>80%)

**R2: Per-message cost** — optional, shown on assistant messages. The data is already in `AssistantMessage.usage`. Display as a subtle label: `↑1.2k ↓340 · $0.003`

**R3: Real-time updates** — stats should update after every turn, not just on demand. Two approaches:
- **Option A (polling)**: New `get_stats` WS command, client polls every N seconds during streaming. Simple but wastes bandwidth when idle.
- **Option B (push)**: Server sends a `stats_update` event after every `turn_end` and `agent_end`. More efficient, no wasted requests. **Recommended.**

**R4: Multi-session awareness** — when background sessions are running, the sidebar's live session list should show per-session cost so the user can see burn rate across sessions.

### Implementation Notes

- Server: add `getSessionStats()` and `getContextUsage()` calls in `ws/handler.ts`, emit `stats_update` event in the subscription callback when `turn_end` or `agent_end` events fire
- Server: include stats in `session_created` and `session_switched` responses so the UI has initial values when loading a session
- Client: new `SessionStats` and `ContextUsage` types in `types.ts`
- Client: store stats per session (either in `sessionDataMap` or separate)
- Client: new `Footer.svelte` / `Footer.tsx` component
- Client: context percentage bar is a simple div with width% and background color

### Open Questions

- Should per-message cost be opt-in (settings toggle) or always shown?
- Should cost display be per-session only, or also show cumulative across all sessions in the tab?

---

## Feature 2: Predictive Directory Input

### Problem

The "New Session" dialog has a plain text input for the working directory. The user has to type or paste the full path. There's no autocomplete, no directory browsing, no indication of what's inside a directory. This is friction every time you start a session in a new project.

### Requirements

**R1: Directory autocomplete** — as the user types, show a dropdown of matching directories. Triggered on every keystroke (debounced). The server lists directory contents and filters by the partial input.

**R2: Server endpoint** — `GET /api/list-dir?path=/foo/bar&prefix=src` returns:
```json
{
  "entries": [
    { "name": "src", "isDir": true },
    { "name": "scripts", "isDir": true }
  ],
  "resolved": "/foo/bar"
}
```
Only return directories (not files) — this is a directory picker. Limit results (e.g., 50 entries) to avoid dumping huge directory listings. Support `~` expansion. Handle permission errors gracefully.

**R3: Path segment completion** — typing `/Users/mar` should suggest `/Users/marcuslyons/`. Typing `~/gi` should suggest `~/github/`. After selecting a suggestion, the input updates and the dropdown refreshes for the next segment.

**R4: Keyboard navigation** — Arrow keys to navigate suggestions, Tab or Enter to accept the highlighted suggestion (appending it to the path), Enter on an empty suggestion list to create the session. Escape closes the dropdown.

**R5: Recent directories** — already implemented as quick-pick buttons. Keep these. They should also appear in the dropdown as a "Recent" section at the top when the input is empty or matches.

**R6: Visual cues** — show a folder icon next to directory names. Dim entries that are hidden (dotfiles) unless the user has typed a `.` prefix. Show the number of subdirectories inside each suggestion if cheaply available.

### Implementation Notes

- Server: new route in `api/routes.ts`. Use `fs.readdir` with `withFileTypes: true`. Filter to directories only. Sort alphabetically. Resolve `~` with `os.homedir()`. Catch `EACCES`/`ENOENT`.
- Client: the autocomplete dropdown is a positioned `<ul>` below the input. Track `highlightedIndex` for keyboard nav. Debounce the fetch to ~150ms.
- The existing `validate-path` endpoint stays — it's used for final validation before session creation. The new `list-dir` endpoint is for browsing.
- Consider: should we also show a small file tree preview when hovering a suggestion? Probably overkill for v1.

### Open Questions

- Should the autocomplete fire on focus (showing recent dirs) or only after typing?
- Do we need to handle Windows paths (backslash) or is this Unix-only for now?

---

## Feature 3: Session Persistence Across Server Restarts

### Problem

When the pi-webhost server shuts down (intentional or crash), all live WebSocket connections drop and all in-memory `ManagedSession` instances are destroyed. The browser shows "Connecting to server..." and when it reconnects, it's a blank slate. The user loses their active session context even though Pi persisted the session to disk.

### What Actually Survives a Restart

Pi's `SessionManager` writes session data to JSONL files in `~/.pi/agent/sessions/`. These files contain the full message history, tool calls, results, and compaction entries. They survive server restarts. The `SessionManager.list()` and `SessionManager.open()` APIs can enumerate and reopen them.

**What's lost**: The `AgentSession` runtime state — the subscribed event listeners, the in-flight streaming, any queued steer/follow-up messages, and the model selection if it differs from settings defaults.

### Requirements

**R1: Auto-reconnect with session restoration** — when the WebSocket reconnects after a disconnect:
1. Client sends a `restore_sessions` command with a list of `{ sessionPath, wasActive }` for each session it had open
2. Server reopens each session via `SessionManager.open(path)`
3. Server sends back `session_restored` events with the session ID mappings and current message state
4. Client matches restored sessions to its cached data and resumes

**R2: Client-side session memory** — the client already caches messages per session in `sessionDataMap`. On reconnect, it doesn't need to re-fetch messages it already has. The restore flow should:
- Reopen the session on the server so new prompts work
- NOT resend all messages (client already has them)
- Send a `stats_update` so the footer is accurate
- Re-establish event forwarding so new events flow

**R3: Server-side session registry** — optional enhancement: the server maintains a lightweight JSON file (`~/.pi/agent/pi-webhost-state.json` or similar) that tracks which sessions were active. On startup, the server can pre-load this list and offer it to reconnecting clients. This handles the case where the browser was also closed (no client-side cache).

**R4: Graceful degradation** — if a session can't be restored (file deleted, corrupted), the client should show a notification and remove it from the live sessions list. Don't block other sessions from restoring.

**R5: In-flight work** — if a session was mid-stream when the server died, that work is lost. The restored session picks up from the last completed turn. The client should detect if a session was streaming when disconnected and show a notice: "Session was interrupted. Last completed message shown."

### Architecture Options

**Option A: Client-driven restore (recommended for v1)**
- Client stores `activeSessionPaths` in localStorage
- On WebSocket reconnect, client sends `restore_sessions` with the paths
- Server opens each one, sends back the session IDs
- Simple, no server-side persistence needed beyond what Pi already does
- Limitation: only works if the same browser tab reconnects

**Option B: Server-side state file**
- Server writes `{ activeSessions: [{ path, cwd, model, thinkingLevel }] }` to a JSON file on every session change
- On startup, server reads this file and pre-opens sessions
- Reconnecting client gets the sessions immediately
- Works even if the browser was closed and reopened
- More complex, introduces a new state file to manage

**Option C: SQLite session index**
- Overkill for this use case. The session data is already in JSONL files managed by Pi's SessionManager. Adding SQLite creates a second source of truth and sync headaches.

### Implementation Notes

- The reconnect logic already exists (`reconnectTimer` in the WebSocket client). The gap is that after reconnecting, nothing happens — it's a fresh connection.
- `SessionManager.open(path)` is the key API — it loads the full session from disk. It's already used by `switch_session`.
- For Option A, the client can store paths in localStorage: `localStorage.setItem('pi-webhost:activeSessions', JSON.stringify([...]))`
- The new `restore_sessions` WS command is essentially a batch `switch_session` — open multiple sessions at once, set the active one, and send back session info for each.
- The `session_restored` response per session should include: `sessionId`, `sessionPath`, `cwd`, `model`, `thinkingLevel`, `messageCount` (so the client knows if it needs to fetch messages or if its cache is sufficient).

### Open Questions

- Should we restore the model selection? If the user picked a model that's no longer available (API key removed), we need a fallback.
- Should session restore be automatic or require a user action (e.g., "Restore previous sessions?" prompt)?
- How do we handle multiple browser tabs? If two tabs both try to restore the same session, they'd create duplicate `AgentSession` instances operating on the same JSONL file. Pi's file locking might handle this, but it needs testing.
- Is there value in a "session bookmark" concept — explicitly marking sessions to survive restarts vs. ephemeral sessions that are discarded?

---

## Priority & Sequencing

| Feature | Impact | Effort | Suggested Order |
|---------|--------|--------|-----------------|
| Session Telemetry | High — core visibility gap | Medium | 1st |
| Directory Autocomplete | Medium — QoL improvement | Low-Medium | 2nd |
| Session Persistence | High — critical for reliability | Medium-High | 3rd |

Telemetry first because the data is already available and the feature is self-contained. Directory autocomplete second because it's small and independent. Session persistence last because it touches the reconnect flow and needs the most design decisions.
