# pi-webhost

Self-hosted web interface for the [Pi coding agent](https://github.com/badlogic/pi-mono). Runs on a server (Mac Mini, homelab, etc.) and exposes Pi through a browser — start a task from your laptop, pick it up on your phone.

> **Status**: Active development. Core chat works. Multi-device session persistence is next.

## What This Does

Pi is a terminal-based coding agent. pi-webhost wraps its SDK to give you:

- **Real-time streaming chat** in the browser with tool call visualization (read, write, edit, bash)
- **Multiple concurrent sessions** — start several tasks, they run in parallel
- **Model switching** — any provider Pi supports (Anthropic, OpenAI, Google, etc.)
- **Thinking level control** — adjust reasoning depth per session
- **Session persistence** — sessions save to disk via Pi's SessionManager, resume later
- **OAuth passthrough** — use Anthropic Pro/Max or OpenAI Plus/Pro subscriptions

It does **not** use Pi's `web-ui` package (`@mariozechner/pi-web-ui`), which is designed for browser-side agents calling LLM providers directly. pi-webhost runs the agent **server-side** with real filesystem tools, streaming events to the browser over WebSocket.

## Quick Start

```bash
git clone https://github.com/marcuslyons/pi-webhost.git
cd pi-webhost
npm install

# Authentication — pick one or more:

# Option A: Environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# Option B: Pi's OAuth (run in terminal first)
pi
/login  # Complete OAuth flow, then quit
# Credentials stored in ~/.pi/agent/auth.json, picked up automatically

# Option C: Set via the web UI sidebar (runtime only)

# Start
npm run dev
```

Open `http://localhost:5173`.

## Architecture

```
packages/
├── server/              Hono + Node.js, port 3141
│   ├── agent/manager.ts     Pi AgentSession lifecycle
│   ├── api/routes.ts        REST: models, auth, sessions, health
│   ├── ws/handler.ts        WebSocket ↔ Pi event bridge
│   └── index.ts             Server entry, CORS, static serving
│
└── web/                 React 19 + Vite + Tailwind v4
    ├── hooks/useAgent.ts    WebSocket client, event routing
    ├── stores/chatStore.ts  Zustand state (per-session data)
    ├── components/          Chat, Editor, Header, Sidebar, Message, NewSessionDialog
    └── lib/types.ts         Shared TypeScript interfaces
```

**Data flow**: User input → WebSocket → Server → Pi `AgentSession.prompt()` → Pi events → WebSocket → Client renders streamed text, tool calls, results.

**Authentication**: Pi's `AuthStorage` resolves credentials in order: runtime API keys (set via UI) → `~/.pi/agent/auth.json` → environment variables.

### WebSocket Protocol

Client sends JSON commands:

```jsonc
{"type": "prompt", "message": "What files are in src/"}
{"type": "abort"}
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}
{"type": "set_thinking_level", "level": "medium"}
{"type": "new_session", "cwd": "/path/to/project"}
{"type": "switch_session", "sessionPath": "/path/to/session.jsonl"}
{"type": "close_session", "sessionId": "abc123"}
{"type": "compact"}
{"type": "steer", "message": "Focus on the tests"}
{"type": "follow_up", "message": "Now run them"}
```

Server streams tagged events (every event includes `sessionId`):

```jsonc
{"type": "event", "sessionId": "abc", "event": {"type": "message_update", ...}}
{"type": "event", "sessionId": "abc", "event": {"type": "tool_execution_start", "toolName": "bash", ...}}
{"type": "session_created", "sessionId": "abc", "model": {...}}
{"type": "live_sessions", "sessions": [...]}
```

### REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/models` | GET | Available models (filtered by valid credentials) |
| `/api/sessions` | GET | Active sessions |
| `/api/sessions/persisted` | GET | Saved sessions on disk |
| `/api/auth/status` | GET | Which providers have credentials |
| `/api/auth/api-key` | POST | Set a runtime API key |
| `/api/cwd` | GET | Server working directory + home |
| `/api/validate-path` | GET | Validate a directory path |

## Development

```bash
npm run dev          # Server (3141) + Vite (5173) concurrently
npm run typecheck    # TypeScript checking, both packages
npm run build        # Production build
```

```bash
# Individual packages
npm run dev -w packages/server
npm run dev -w packages/web
```

Vite proxies `/api/*` and `/ws` to the server in dev mode.

## Production

```bash
npm run build
NODE_ENV=production npm start
```

Serves the built frontend from `packages/web/dist/` on port 3141 (or `$PORT`).

## Roadmap

Tracked in `docs/prds/` and `docs/plans/`:

- **Server-owned sessions** — sessions persist independent of browser connections. Start from laptop, continue from phone. Multi-device attach/detach. ([PRD-001](docs/prds/001-telemetry-autocomplete-persistence.md))
- **Session telemetry** — token counts (↑↓), cache stats (R/W), cost, context window % in a footer bar. Data is available via `session.getSessionStats()` and `session.getContextUsage()`. ([PRD-001](docs/prds/001-telemetry-autocomplete-persistence.md))
- **Directory autocomplete** — predictive path input when creating new sessions. ([PRD-001](docs/prds/001-telemetry-autocomplete-persistence.md))
- **Svelte 5 migration** — replace React + Zustand with Svelte runes. Server untouched. ([migration plan](docs/plans/svelte-migration.md), [analysis](docs/svelte-migration-analysis.md))

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3141` | Server port |
| `NODE_ENV` | — | `production` to serve built frontend |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |

## License

[MIT](LICENSE)
