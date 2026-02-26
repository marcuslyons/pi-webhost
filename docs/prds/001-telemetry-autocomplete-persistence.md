# PRD-001: Session Telemetry, Directory Autocomplete, Server-Owned Sessions

Three features that bring pi-webhost closer to the Pi terminal experience and enable multi-device workflows.

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

## Feature 3: Server-Owned Sessions (Multi-Device, Persistence, Detach/Attach)

### Problem

The current architecture ties sessions to WebSocket connections. When a connection drops — browser closed, laptop lid shut, network blip — the server destroys the session. This makes multi-device usage impossible and means even temporary disconnects lose state.

The target use case: pi-webhost runs on a Mac Mini on the home network. Start a long-running task from the laptop, close the laptop, pick it up on the phone while away, come back to the laptop later and continue. The agent keeps working regardless of which device (if any) is connected.

### Fundamental Architecture Change

Sessions must be **server-owned**, not **connection-owned**.

Current model:
```
WebSocket connects → session created → session lives in connection state
WebSocket disconnects → session destroyed
```

Target model:
```
Server manages a session pool (independent of connections)
WebSocket connects → client attaches to session(s) as a viewer/controller
WebSocket disconnects → client detaches, session keeps running
Agent completes work → results persisted, available when any client attaches
```

This is the single biggest architectural change in pi-webhost. Everything else (restart survival, multi-device) falls out of it naturally.

### What Pi Gives Us

Pi's `SessionManager` already persists all session data to JSONL files in `~/.pi/agent/sessions/`. Full message history, tool calls, results, and compaction entries survive anything.

`AgentSession` instances are the runtime objects that hold the LLM connection, tool execution, and event subscriptions. These live in memory and are lost on process death. But they can be reconstructed from the persisted session file via `SessionManager.open(path)`.

Key insight: the agent loop (`session.prompt()`) is an async operation that runs server-side. It doesn't need a WebSocket client to be connected. It just needs the `AgentSession` to exist in memory.

### Requirements

**R1: Session pool** — the server maintains a `Map<sessionId, ManagedSession>` at the `AgentManager` level, not per-connection. Sessions are created, run, and persist independently of any WebSocket connection.

**R2: Attach/detach model** — WebSocket connections don't own sessions. Instead:
- `attach_session { sessionId }` — start receiving events for a session. Multiple clients can attach to the same session simultaneously.
- `detach_session { sessionId }` — stop receiving events. Session keeps running.
- `detach_all` (implicit on WebSocket close) — client goes away, all sessions continue.

**R3: Background execution** — when a prompt is running and no client is attached, the agent keeps working. Events are generated and persisted (Pi handles this via SessionManager). When a client attaches later, it loads the current state from `session.messages`.

**R4: Multi-client support** — two devices attached to the same session both receive real-time events. Both can send prompts. The session handles this like the terminal Pi handles message queuing — steering and follow-up messages work the same way. No conflict resolution needed because Pi's agent loop is sequential (one turn at a time).

**R5: Server restart recovery** — the server writes an active session manifest to disk (`~/.pi/agent/pi-webhost/active-sessions.json`):
```json
{
  "sessions": [
    {
      "sessionPath": "/path/to/session.jsonl",
      "cwd": "/Users/marcus/project",
      "model": { "provider": "anthropic", "id": "claude-sonnet-4-..." },
      "thinkingLevel": "medium"
    }
  ]
}
```
On startup, the server reopens all sessions from this manifest. Reconnecting clients find them already running.

**R6: Client reconnect flow** — when a client reconnects (WebSocket open after disconnect):
1. Client sends `list_active_sessions` to get the server's session pool
2. Server responds with all active sessions: `{ sessionId, sessionPath, cwd, model, isStreaming, messageCount }`
3. Client matches against its locally cached sessions (in localStorage or memory)
4. Client sends `attach_session` for each session it wants to follow
5. If the client has no cache (new device), it sends `get_messages { sessionId }` to load history

**R7: Session lifecycle** — sessions are explicitly closed by the user (`close_session`), not by disconnects. Idle sessions (no prompts for X hours) could be automatically closed to free memory, with a configurable timeout. Closed sessions remain on disk and can be reopened.

**R8: Interrupted streams** — if the server dies mid-stream, the `AgentSession` is lost. On restart, the session is reopened from disk at the last completed turn. The client should detect this: if a session was `isStreaming: true` before disconnect and `isStreaming: false` after reconnect with no new messages, show: "Session was interrupted. Showing last completed state."

### Architecture

#### Server Changes

**`AgentManager` becomes the session pool owner:**
```
AgentManager
├── sessions: Map<string, ManagedSession>    // THE pool, lives here
├── subscribers: Map<string, Set<WSContext>>  // sessionId → connected clients
├── manifest: ActiveSessionManifest          // persisted to disk
│
├── createSession(cwd) → ManagedSession
├── openSession(path) → ManagedSession
├── closeSession(id)                         // destroy + remove from manifest
│
├── attachClient(sessionId, ws)              // add to subscribers
├── detachClient(sessionId, ws)              // remove from subscribers
├── detachAllForClient(ws)                   // on WS close
│
├── broadcastEvent(sessionId, event)         // send to all attached clients
└── saveManifest() / loadManifest()          // disk persistence
```

**`ws/handler.ts` becomes thin:**
- `ConnectionState` no longer holds sessions — just tracks which sessions this client is attached to
- `onClose` calls `agentManager.detachAllForClient(ws)` instead of destroying sessions
- Commands like `prompt`, `abort`, `set_model` route through `agentManager` which finds the session by ID
- Event forwarding is set up in `AgentManager.attachClient()`, not per-connection

**Event subscription moves to AgentManager:**
- When a session is created, `AgentManager` subscribes to its events once
- Events are broadcast to all attached clients via `subscribers.get(sessionId)`
- No re-subscribing on attach/detach — the subscription is permanent for the session's lifetime

**Manifest file:**
- Written on every session create/close/model change (debounced, async)
- Read on server startup
- Location: `~/.pi/agent/pi-webhost/active-sessions.json`
- If the file is missing or corrupt, start with an empty pool (sessions can still be opened from Pi's session files)

#### Client Changes

**Connection lifecycle:**
```
WebSocket opens
  → send list_active_sessions
  → receive session list
  → match against localStorage cache
  → attach to sessions
  → load messages for any sessions not in cache
  → resume UI
```

**localStorage schema:**
```json
{
  "attachedSessions": [
    { "sessionPath": "...", "activeSessionPath": "..." }
  ],
  "activeSessionPath": "..."
}
```

This is lightweight — just enough to know what to reattach to. The actual message cache is in memory (`sessionDataMap`) and repopulated from the server on new page loads.

**Multi-device scenario:**
```
Laptop: attach to session A → send prompt → see streaming
Phone:  connect → list_active_sessions → sees session A (streaming)
        → attach to session A → starts receiving events mid-stream
        → can send follow_up while laptop also watches
Laptop: close lid → detach (implicit) → session A continues
Phone:  still attached → still seeing events
        → agent finishes → send new prompt from phone
Laptop: open lid → reconnect → reattach → see everything phone did
```

### Migration Path

This is a breaking change to the WebSocket handler and AgentManager. Suggested phased approach:

**Phase 1: Move session pool to AgentManager**
- `AgentManager` owns the session `Map`, not `ConnectionState`
- `onClose` stops destroying sessions (just detaches)
- Sessions without attached clients idle but stay alive
- Single-client still works exactly as before
- No manifest yet — sessions lost on restart

**Phase 2: Add attach/detach protocol**
- New commands: `attach_session`, `detach_session`, `list_active_sessions`
- `broadcastEvent` sends to all attached clients
- Multi-client works

**Phase 3: Manifest persistence**
- Write `active-sessions.json` on session changes
- Read on startup, reopen sessions
- Restart recovery works

**Phase 4: Client reconnect flow**
- localStorage tracking of attached sessions
- Auto-reattach on reconnect
- Message catch-up for stale caches
- Multi-device works end-to-end

### Open Questions

- **Session limits**: should there be a max number of active sessions? Memory scales with session count (each `AgentSession` holds full message history). A limit of 10-20 active sessions seems reasonable.
- **Idle timeout**: auto-close sessions after N hours of no prompts? Or keep them alive indefinitely until explicit close? Leaning toward a configurable timeout (default: 24h) with a "pin" option to exempt specific sessions.
- **Concurrent prompts**: two devices both send a prompt to the same session at the same time. Pi's agent loop is sequential, so the second prompt would queue as a follow-up. Is that the right behavior, or should we lock the session to one prompter at a time?
- **Device identification**: should clients identify themselves (device name, browser ID) so the UI can show "Laptop is also viewing this session"? Nice for awareness, not strictly necessary.
- **Security**: if this is on a home network, auth is probably unnecessary. But if exposed beyond LAN (tailscale, etc.), we'd want some form of authentication. Out of scope for this PRD but worth noting.
- **Event buffering vs. replay**: when a new client attaches to a streaming session, should it receive buffered events from the current turn (partial text), or just start receiving from the current point? Getting partial state right (mid-stream text already generated) requires either buffering or reading from `session.messages` which includes the in-progress assistant message.

---

## Priority & Sequencing

| Feature | Impact | Effort | Suggested Order |
|---------|--------|--------|-----------------|
| Server-Owned Sessions | Critical — enables everything else | High | 1st |
| Session Telemetry | High — core visibility gap | Medium | 2nd |
| Directory Autocomplete | Medium — QoL improvement | Low-Medium | 3rd |

Server-owned sessions first. It's the largest change and everything else benefits from it: telemetry is more useful when sessions persist across devices, and the attach/detach model makes reconnect handling clean. The phased migration path (pool → attach/detach → manifest → client reconnect) means each phase is shippable on its own.

Telemetry second because the data is already available and the feature is self-contained.

Directory autocomplete third — small, independent, can land any time.
