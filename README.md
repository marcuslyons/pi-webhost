<p align="center">
  <img src="packages/web/public/pi.svg" alt="pi-webhost" width="64">
</p>

<h1 align="center">pi-webhost</h1>

<p align="center">
  Browser interface for the <a href="https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent">Pi coding agent</a>.
  <br />
  Run Pi on a server, use it from any device.
</p>

> **Early development.** Core chat works. Multi-device session persistence is next.

---

## What This Is

Pi is a terminal coding agent. pi-webhost wraps [Pi's SDK](https://github.com/badlogic/pi-mono/blob/main/docs/sdk.md) to run the agent server-side and stream results to a browser over WebSocket. The server holds the sessions — you connect from whatever device is in front of you.

**Target setup:** Pi running on a Mac Mini (or any always-on machine) on your home network. Start a task from your laptop. Close the lid. Pick it up on your phone. The agent keeps working.

pi-webhost does **not** use Pi's [`web-ui`](https://github.com/badlogic/pi-mono/tree/main/packages/web-ui) package. That library is designed for browser-side agents that call LLM providers directly via `fetch`. pi-webhost runs the full coding agent server-side with real filesystem tools (`read`, `write`, `edit`, `bash`), streaming events to the browser.

## Features

- **Real-time streaming** — tool calls, results, thinking blocks, and text render as they arrive
- **Concurrent sessions** — run multiple tasks in parallel, switch between them instantly
- **Model switching** — any provider Pi supports (Anthropic, OpenAI, Google, Groq, etc.)
- **Thinking levels** — adjust reasoning depth per session
- **Session persistence** — sessions save to disk via Pi's SessionManager, resume later
- **Working directory per session** — each session targets a specific project
- **OAuth passthrough** — use Anthropic Pro/Max or OpenAI Plus/Pro subscriptions via Pi's `/login`
- **API key support** — set keys per-provider from the UI or environment variables

## Quick Start

```bash
git clone https://github.com/marcuslyons/pi-webhost.git
cd pi-webhost
npm install
```

Set up authentication (pick one or more):

```bash
# API key
export ANTHROPIC_API_KEY=sk-ant-...

# Or Pi's OAuth — run in terminal first, then quit
pi
/login
```

Start the dev servers:

```bash
npm run dev
```

Open **http://localhost:5173**.

## Architecture

```
packages/
├── server/                 Hono · Node.js · port 3141
│   ├── agent/manager.ts       AgentSession lifecycle, model registry, auth
│   ├── ws/handler.ts          WebSocket ↔ Pi event bridge
│   ├── api/routes.ts          REST endpoints
│   └── index.ts               Server entry
│
└── web/                    React 19 · Vite · Tailwind v4
    ├── hooks/useAgent.ts      WebSocket client, per-session event routing
    ├── stores/chatStore.ts    Zustand state management
    ├── components/            Chat, Editor, Header, Sidebar, Message, NewSessionDialog
    └── lib/types.ts           Shared types
```

**How it works:**

1. Server creates Pi `AgentSession` instances via the SDK
2. Browser connects over WebSocket, sends commands (prompt, abort, set_model, ...)
3. Server subscribes to Pi events, forwards them as tagged JSON (every event includes `sessionId`)
4. Client routes events to per-session message arrays and renders in real-time
5. Authentication flows through Pi's `AuthStorage` — same `~/.pi/agent/auth.json` used by the CLI

### WebSocket Commands

| Command | Description |
|---|---|
| `prompt` | Send a user message (supports images) |
| `abort` | Cancel in-flight generation |
| `set_model` | Switch provider + model |
| `set_thinking_level` | Adjust reasoning depth |
| `new_session` | Create session (optional `cwd`) |
| `switch_session` | Open a persisted session from disk |
| `set_active_session` | Switch displayed session (client-side) |
| `close_session` | Destroy a live session |
| `steer` | Inject message during tool execution (interrupts remaining tools) |
| `follow_up` | Queue message for after agent finishes |
| `compact` | Summarize context to free tokens |
| `get_models` | List available models |
| `get_messages` | Fetch message history for a session |
| `get_state` | Get current session state |
| `list_persisted_sessions` | List saved sessions on disk |

### REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/models` | GET | Available models (filtered by valid credentials) |
| `/api/sessions` | GET | Active sessions |
| `/api/sessions/persisted` | GET | Saved sessions on disk |
| `/api/auth/status` | GET | Which providers have credentials |
| `/api/auth/api-key` | POST | Set a runtime API key |
| `/api/cwd` | GET | Server working directory and home path |
| `/api/validate-path` | GET | Validate a directory path exists |

## Authentication

pi-webhost uses Pi's credential system. Credentials resolve in order:

1. **Runtime API keys** — set via the sidebar UI or `/api/auth/api-key` (not persisted across restarts)
2. **Stored credentials** — `~/.pi/agent/auth.json` (written by Pi's `/login` command)
3. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.

For **OAuth subscriptions** (Anthropic Pro/Max, OpenAI Plus/Pro): run `pi` in a terminal, use `/login`, complete the flow. pi-webhost picks up the tokens automatically.

## Development

```bash
npm run dev          # Server (3141) + Vite dev server (5173)
npm run typecheck    # TypeScript check, both packages
npm run build        # Production build
```

Vite proxies `/api/*` and `/ws` to the server in dev mode.

### Individual packages

```bash
npm run dev -w packages/server
npm run dev -w packages/web
```

## Production

```bash
npm run build
NODE_ENV=production npm start    # Serves frontend on port 3141
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3141` | Server port |
| `NODE_ENV` | — | `production` serves built frontend from `packages/web/dist/` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |

## Roadmap

See **[ROADMAP.md](ROADMAP.md)** for the full picture. The short version:

1. **Server-owned sessions** — sessions survive client disconnects and device switches (the multi-device story)
2. **Session telemetry** — token counts, cost, context % in the UI
3. **Directory autocomplete** — predictive path input for new sessions
4. **Svelte 5 migration** — replace React + Zustand with Svelte runes

PRDs in [`docs/prds/`](docs/prds/), task plans in [`docs/plans/`](docs/plans/).

## What This Isn't

This is not a managed service or multi-tenant platform. It's a personal tool that runs on your machine, on your network, with your credentials. There's no user auth, no rate limiting, no billing. If you expose it beyond localhost, that's on you.

This is not a replacement for Pi's terminal interface. The terminal TUI has features (extensions, themes, keyboard shortcuts, `/tree`, branching, file references) that the web UI doesn't attempt to replicate. pi-webhost optimizes for accessibility from any device, not feature parity.

## License

[MIT](LICENSE)
