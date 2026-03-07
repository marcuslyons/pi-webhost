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

### Svelte 5 Migration

> Replace React + Zustand with Svelte 5 runes. Server untouched.

12 discrete tasks. ~30% less frontend code, ~40% smaller bundle. Svelte 5 runes eliminate most of the React boilerplate (no `useCallback`, `useRef`, `useEffect`, Zustand selectors).

Plan: [`docs/plans/svelte-migration.md`](docs/plans/svelte-migration.md)
Analysis: [`docs/svelte-migration-analysis.md`](docs/svelte-migration-analysis.md)
