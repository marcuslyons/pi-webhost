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
- [x] Session naming and deletion from sidebar
- [x] Session telemetry — footer bar with token counts, cost, context usage; per-message cost labels; per-session cost in sidebar
- [x] Directory autocomplete — predictive path completion in new session dialog with keyboard navigation
- [x] Image paste and drag-to-attach in the editor
- [x] Mobile-optimized responsive layout
- [x] Search within sessions — full-text search with match navigation (Cmd+F)
- [x] Server-owned sessions — sessions persist independent of browser connections, multi-client attach/detach, manifest-based restart recovery, auto-reattach on reconnect
- [x] HTTPS and auth gateway — optional TLS and basic auth for exposing beyond localhost
- [x] Extension UI protocol — forward and render extension prompts (confirm, text input, select)

PRD: [`docs/prds/001-telemetry-autocomplete-persistence.md`](docs/prds/001-telemetry-autocomplete-persistence.md)
Tasks: [`docs/plans/feature-tasks.md`](docs/plans/feature-tasks.md)

## Up Next

### UX Improvements (inspired by [Tau](https://github.com/deflating/tau))

Several UX patterns borrowed from Tau, a Pi extension that mirrors terminal sessions in the browser. Different architecture but great feature ideas.

- **Inline diff viewer** — render edit tool calls as red/green diffs instead of raw JSON
- **Message queuing** — keep input enabled during streaming, show queued messages as dismissible pills, auto-send when agent finishes
- **PWA / installable app** — service worker + web manifest for standalone install on iOS/Android/macOS
- **Voice input** — mic button with Web Speech API for on-device dictation
- **Command palette** — Cmd+K palette for power-user actions (compact, stats, search, new session)
- **Tab title notifications** — unread message count in browser tab when backgrounded

Tasks: [`docs/plans/feature-tasks-v2.md`](docs/plans/feature-tasks-v2.md)

### Svelte 5 Migration

> Replace React + Zustand with Svelte 5 runes. Server untouched.

12 discrete tasks. ~30% less frontend code, ~40% smaller bundle. Svelte 5 runes eliminate most of the React boilerplate (no `useCallback`, `useRef`, `useEffect`, Zustand selectors).

Plan: [`docs/plans/svelte-migration.md`](docs/plans/svelte-migration.md)
Analysis: [`docs/svelte-migration-analysis.md`](docs/svelte-migration-analysis.md)

## Exploring

Bigger ideas worth investigating. The first three are inspired by [Tau](https://github.com/deflating/tau)'s roadmap — credit to that project for surfacing them.

- **File browser sidebar** *(Tau)* — lazy-loaded file tree in a right sidebar. Navigate directories, open files natively, drag files onto the input to insert paths. Builds on existing directory autocomplete.
- **File preview panel** *(Tau)* — context-aware split pane for files the agent is editing. Code with syntax highlighting, image previews, live HTML iframe preview. Auto-show when a file gets edited.
- **Conversation fork/branch visualization** *(Tau)* — Pi already has fork support in the RPC. Visualize the conversation as a tree, go back to any point and try a different approach. Like git for conversations.
- **Cost dashboard** — spending over time, per model, per project. Charts and trends. Telemetry data already captured per message and per session.
- **Theme system** — multiple dark and light themes with OS preference detection. Currently dark-only.
- **Session templates** — start a new session pre-loaded with context for a specific project. Working directory, starter prompt, model preset.
