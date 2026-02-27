# Roadmap

What's planned, what's done, and what's being explored. PRDs and plans live in `docs/`.

---

## Done

- [x] Real-time streaming chat with tool call visualization
- [x] Multiple concurrent sessions per browser tab
- [x] Model selection and thinking level control
- [x] Session persistence to disk (create, switch, resume)
- [x] Working directory selection per session
- [x] OAuth passthrough (Anthropic Pro/Max, OpenAI Plus/Pro)
- [x] API key management from the UI
- [x] Steer and follow-up messages during agent execution
- [x] Session compaction

## Up Next

### Server-Owned Sessions

> Sessions persist independent of browser connections. Multi-device attach/detach.

The foundational change. Currently sessions are tied to WebSocket connections — disconnect kills the session. The target: sessions live on the server, clients attach and detach. Start a task from your laptop, close the lid, pick it up on your phone.

**Phases:**
1. Move session pool from per-connection to `AgentManager`
2. Attach/detach protocol — multiple clients can view the same session
3. Active session manifest persisted to disk — survive server restarts
4. Client reconnect flow with auto-reattach

PRD: [`docs/prds/001-telemetry-autocomplete-persistence.md`](docs/prds/001-telemetry-autocomplete-persistence.md) (Feature 3)

### Session Telemetry

> Token counts, cost, and context window usage in the UI.

The data is already available — `session.getSessionStats()` returns input/output/cache tokens and cost, `session.getContextUsage()` returns context window percentage. Needs a footer bar and per-message cost labels.

Format: `↑12.4k ↓3.2k R8.1k W2.0k $0.42 · 48% of 200k`

PRD: [`docs/prds/001-telemetry-autocomplete-persistence.md`](docs/prds/001-telemetry-autocomplete-persistence.md) (Feature 1)

### Directory Autocomplete

> Predictive path completion when creating new sessions.

New server endpoint (`/api/list-dir`) lists directories as the user types. Keyboard navigation, path segment completion, recent directories. Replaces the current plain text input with debounced validation.

PRD: [`docs/prds/001-telemetry-autocomplete-persistence.md`](docs/prds/001-telemetry-autocomplete-persistence.md) (Feature 2)

## Planned

### Svelte 5 Migration

> Replace React + Zustand with Svelte 5 runes. Server untouched.

12 discrete tasks. ~30% less frontend code, ~40% smaller bundle. Svelte 5 runes eliminate most of the React boilerplate (no `useCallback`, `useRef`, `useEffect`, Zustand selectors).

Plan: [`docs/plans/svelte-migration.md`](docs/plans/svelte-migration.md)
Analysis: [`docs/svelte-migration-analysis.md`](docs/svelte-migration-analysis.md)

## Exploring

Ideas that are worth investigating but don't have PRDs yet.

- **Image paste/drag** — Pi supports image input (`ImageContent`). The editor should support paste and drag-to-attach.
- **Session naming/deletion** — rename sessions from the sidebar, delete old ones
- **Search within sessions** — full-text search across message history
- **Extension UI protocol** — Pi extensions can request user interaction. Surface that in the web UI.
- **Mobile-optimized layout** — responsive design for phone-sized screens (the sidebar especially)
- **HTTPS / auth gateway** — for exposing beyond localhost (Tailscale, Cloudflare Tunnel, etc.)
