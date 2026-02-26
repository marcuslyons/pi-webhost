# pi-webhost

Self-hosted web interface for the [Pi coding agent](https://github.com/badlogic/pi-mono). Wraps Pi's SDK to provide a browser-based chat UI with streaming, tool execution, and multi-session support.

## Architecture

Monorepo with two packages:

```
packages/server/    Hono backend, Pi SDK integration, WebSocket + REST
packages/web/       React frontend (Svelte migration planned, see docs/plans/)
```

The server and frontend communicate over **WebSocket** for real-time streaming and **REST** for one-shot queries. The WebSocket protocol is the contract between them — changing it affects both sides.

### Server (`packages/server/`)

- **Hono** on Node.js, port 3141
- **Pi SDK** via `@mariozechner/pi-coding-agent` — `createAgentSession()`, `AuthStorage`, `ModelRegistry`, `SessionManager`
- **`agent/manager.ts`** — Creates and manages `AgentSession` instances. One per logical session. Handles `createSession`, `openSession` (from disk), `listPersistedSessions`, `destroySession`.
- **`ws/handler.ts`** — WebSocket handler. Supports **multiple concurrent sessions per connection**. Each connection has a `Map<sessionId, ManagedSession>` and an `activeSessionId`. All events are tagged with `sessionId`. Commands: `prompt`, `abort`, `steer`, `follow_up`, `set_model`, `set_thinking_level`, `get_state`, `get_messages`, `get_models`, `compact`, `new_session`, `switch_session`, `set_active_session`, `close_session`, `list_persisted_sessions`.
- **`api/routes.ts`** — REST endpoints: `/api/health`, `/api/models`, `/api/sessions`, `/api/sessions/persisted`, `/api/auth/status`, `/api/auth/api-key`, `/api/cwd`, `/api/validate-path`.
- **`index.ts`** — Server entry. CORS in dev, static file serving in production, graceful shutdown.

### Frontend (`packages/web/`)

- **React 19** + Vite + Tailwind CSS v4
- **Zustand** for state management (`stores/chatStore.ts`)
- **`hooks/useAgent.ts`** — WebSocket client, event routing, public API. Events are tagged with `sessionId` and routed to per-session data in the store.
- **Per-session data** stored in `sessionDataMap: Map<string, SessionData>`. Switching active session is instant (just changes `activeSessionId`).
- **Components**: App, Chat, Editor, Header, Message, NewSessionDialog, Sidebar
- **`lib/types.ts`** — Shared TypeScript interfaces (framework-agnostic)

### Key Concepts

- **Concurrent sessions**: Multiple sessions can run simultaneously in one browser tab. Creating or switching sessions does NOT destroy the previous one. Background sessions keep streaming and accumulating messages.
- **Session lifecycle**: Sessions are created on first prompt (lazy) or explicitly via `new_session`. They persist to disk via Pi's `SessionManager`. Saved sessions can be reopened via `switch_session`.
- **Event tagging**: Every WebSocket event from server includes `sessionId`. The client routes events to the correct per-session message array regardless of which session is displayed.
- **Auth**: Uses Pi's `AuthStorage.create()` which reads `~/.pi/agent/auth.json` and environment variables. OAuth tokens obtained via Pi CLI's `/login` command are picked up automatically.

## Development

```bash
npm install
npm run dev          # Runs both server (3141) and Vite (5173)
npm run typecheck    # TypeScript checking for both packages
npm run build        # Build web + server for production
```

Server: `http://localhost:3141`
Vite dev: `http://localhost:5173` (proxies `/api` and `/ws` to server)

## Conventions

- TypeScript strict mode everywhere
- Tailwind utility classes, dark theme (zinc palette, violet accents)
- No test framework set up yet — when adding tests, prefer Vitest
- Server uses `.js` extensions in imports (ESM)
- WebSocket protocol uses JSON messages. See `ws/handler.ts` for the full command/event reference.
- Pi SDK docs are at `~/.volta/tools/image/packages/@mariozechner/pi-coding-agent/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`

## Planned Work

- Svelte migration of the frontend — see `docs/plans/svelte-migration.md`
- See `docs/svelte-migration-analysis.md` for the rationale

## Common Tasks

### Adding a new WebSocket command

1. Add the command type to `ClientCommand` union in `packages/server/src/ws/handler.ts`
2. Add the handler case in `handleCommand()`
3. On the client, add the send call in `packages/web/src/hooks/useAgent.ts`
4. Handle the response in `handleServerMessage()` if needed
5. Expose via the hook's return value

### Adding a new REST endpoint

1. Add the route in `packages/server/src/api/routes.ts`
2. Call from the client via `fetch()` (see `fetchAuthStatus` for pattern)

### Modifying session state

1. Update `SessionData` or top-level state in `packages/web/src/stores/chatStore.ts`
2. Add getter/setter if needed
3. Update `useAgent.ts` event handlers to populate the state
4. Read from components via `useChatStore((s) => s.whatever)`
