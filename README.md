# pi-webhost

A self-hosted web interface for the [Pi coding agent](https://github.com/badlogic/pi-mono). Run Pi in your browser with full access to read, write, edit, and bash tools — using your existing Anthropic or OpenAI subscriptions.

Inspired by [OpenCode's self-hosted server](https://opencode.ai/docs/server/).

## Features

- **Browser-based Pi agent** — chat interface with real-time streaming
- **Full tool support** — read, write, edit, bash with output visualization
- **Model selection** — switch between any configured provider/model
- **Thinking levels** — control reasoning depth from the UI
- **OAuth support** — use Anthropic Pro/Max or OpenAI Plus/Pro subscriptions (via Pi's login)
- **API key support** — configure keys for any supported provider
- **Session management** — create new sessions, auto-save to disk
- **WebSocket streaming** — real-time event streaming from the Pi SDK

## Quick Start

```bash
# Clone and install
git clone https://github.com/marcuslyons/pi-webhost.git
cd pi-webhost
npm install

# Set up authentication (pick one or more):

# Option A: Environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# Option B: Use Pi's OAuth (run in terminal first)
pi
/login  # Select your provider, complete OAuth flow, then quit

# Option C: Set via the web UI sidebar (runtime only, not persisted)

# Start development servers
npm run dev
```

Open http://localhost:5173 in your browser.

## Architecture

```
pi-webhost/
├── packages/
│   ├── server/          # Hono backend + Pi SDK integration
│   │   └── src/
│   │       ├── index.ts           # Server entry point
│   │       ├── agent/manager.ts   # Pi AgentSession lifecycle
│   │       ├── api/routes.ts      # REST API (models, auth, sessions)
│   │       └── ws/handler.ts      # WebSocket ↔ Pi event bridge
│   └── web/             # React + Vite + Tailwind frontend
│       └── src/
│           ├── App.tsx
│           ├── components/        # Chat, Editor, Header, Sidebar, Message
│           ├── hooks/useAgent.ts  # WebSocket client + event handling
│           └── stores/chatStore.ts # Zustand state management
```

### How it works

1. The **server** creates Pi `AgentSession` instances via the SDK
2. Each browser tab connects via **WebSocket** and gets its own session
3. The server **subscribes** to Pi events and forwards them as JSON
4. The **client** renders streamed text, tool calls, and results in real-time
5. **Authentication** flows through Pi's `AuthStorage` — the same `~/.pi/agent/auth.json` used by the CLI

### WebSocket Protocol

Client sends JSON commands:
```json
{"type": "prompt", "message": "What files are here?"}
{"type": "abort"}
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}
{"type": "set_thinking_level", "level": "medium"}
{"type": "new_session"}
{"type": "get_models"}
```

Server streams Pi events:
```json
{"type": "event", "event": {"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "Hello"}}}
{"type": "event", "event": {"type": "tool_execution_start", "toolName": "bash", "args": {"command": "ls"}}}
{"type": "session_created", "sessionId": "abc123", "model": {...}}
```

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/models` | GET | List available models (with valid credentials) |
| `/api/sessions` | GET | List active sessions |
| `/api/auth/status` | GET | Check which providers have credentials |
| `/api/auth/api-key` | POST | Set a runtime API key (not persisted) |

## Configuration

### Authentication

pi-webhost uses Pi's credential system. Credentials are resolved in this order:

1. Runtime API keys (set via UI or API, not persisted)
2. Stored credentials in `~/.pi/agent/auth.json`
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

**For OAuth subscriptions** (Anthropic Pro/Max, OpenAI Plus/Pro):
1. Run `pi` in your terminal
2. Use `/login` and complete the OAuth flow
3. Credentials are stored in `~/.pi/agent/auth.json`
4. pi-webhost picks them up automatically

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3141` | Server port |
| `NODE_ENV` | — | Set to `production` to serve built frontend |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |

## Production

```bash
# Build both packages
npm run build

# Start the production server
NODE_ENV=production npm start
```

The server serves the built React app from `packages/web/dist/`.

## Development

```bash
# Run both server and web dev servers
npm run dev

# Server only (port 3141)
npm run dev -w packages/server

# Web only (port 5173, proxies to server)
npm run dev -w packages/web

# Type check
npm run typecheck
```

## License

MIT
