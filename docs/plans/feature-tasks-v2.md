# Feature Task List v2

Prioritized by lowest effort first. Each task is one PR's worth of work.
Excludes the Svelte 5 migration entirely.

Items 1–4 are inspired by [Tau](https://github.com/deflating/tau), a Pi extension that mirrors
terminal sessions in the browser. Different architecture (extension vs standalone server), but
several of its UX patterns are directly applicable.

---

## 1. Inline Diff Viewer for Edit Tool Calls

**Effort: Low** · **Impact: High** · **Source: [Tau](https://github.com/deflating/tau) `public/tool-card.js`**

Edit tool calls are the most common tool output. Currently rendered as raw JSON args. Tau renders
them as red/green inline diffs — vastly more readable.

### Task 1.1 — Diff rendering in Message component

**Files:**
- `packages/web/src/components/Message.tsx` — detect edit tool calls, render diff view
- Tailwind classes (no new CSS files)

**Implementation:**
- In the tool call rendering path, detect when `toolName` is `edit` or `Edit` and both `oldText`/`old_text` and `newText`/`new_text` args are present.
- Instead of showing raw JSON args, render an inline diff:
  - Split `oldText` and `newText` by newlines.
  - Show removed lines with `bg-red-500/10 text-red-400` and a `- ` prefix.
  - Show added lines with `bg-emerald-500/10 text-emerald-400` and a `+ ` prefix.
  - Wrap in a `<pre>` with `font-mono text-xs` for code formatting.
- Fall back to raw JSON display for non-edit tools or when old/new text is missing.
- Collapsible: keep the existing expand/collapse behavior. Diff replaces the args JSON, not the output.

**Acceptance criteria:**
- Edit tool calls show a red/green diff instead of raw JSON
- Non-edit tools still show raw JSON args as before
- Diff is readable in the dark theme (sufficient contrast)
- Long diffs are scrollable within the tool card
- `npm run typecheck` passes

---

## 2. Message Queuing

**Effort: Low-Medium** · **Impact: High** · **Source: [Tau](https://github.com/deflating/tau) `public/app.js`**

Tau keeps the input enabled while the agent is working. Queued messages appear as dismissible
pills above the input and auto-send in order when the agent finishes. pi-webhost has `steer` and
`follow_up` but no visible queue — the user can't see what's pending or cancel individual items.

### Task 2.1 — Client: message queue with visual pills

**Files:**
- `packages/web/src/components/Editor.tsx` — queue state, pill rendering, auto-send logic
- `packages/web/src/stores/chatStore.ts` — add `messageQueue` state if needed (or keep local to Editor)
- `packages/web/src/hooks/useAgent.ts` — expose an event or callback for "agent finished turn" to trigger queue flush

**Implementation:**
- When the user submits a message while `isStreaming` is true, don't send immediately. Push to a local queue array.
- Render queued messages as pills/chips above the input area:
  - Each pill shows a truncated preview of the message text.
  - Each pill has a `×` button to remove it from the queue.
  - Style: `bg-zinc-800 border border-zinc-700 rounded-full px-3 py-1 text-xs`
- When the agent finishes (detected via `isStreaming` transitioning from `true` to `false`), auto-send the first queued message. Continue flushing until the queue is empty.
- The input remains enabled at all times. Placeholder text changes to indicate queuing: "Type to queue a follow-up…"
- Keep existing steer behavior for single messages during streaming. Queue is for the "type multiple messages while agent works" pattern.

**Acceptance criteria:**
- Typing and sending while agent is streaming queues the message
- Queued messages appear as pills above the input
- Each pill is individually dismissible
- Messages auto-send in order when the agent finishes
- Input stays enabled during streaming
- No duplicate sends or lost messages

---

## 3. PWA / Installable App

**Effort: Low** · **Impact: Medium** · **Source: [Tau](https://github.com/deflating/tau) `public/sw.js`, `public/manifest.json`**

pi-webhost is designed for multi-device access — phone on the couch, tablet on the desk. A PWA
manifest and service worker make it installable as a standalone app on iOS, Android, and macOS.
Tau's implementation is minimal and appropriate: network-first strategy with offline fallback,
no aggressive caching since the app connects to a live local server.

### Task 3.1 — Web manifest, service worker, and icons

**Files:**
- `packages/web/public/manifest.json` — new file
- `packages/web/public/sw.js` — new file
- `packages/web/public/icons/` — new directory with icon assets (192, 512, maskable)
- `packages/web/index.html` — add manifest link, meta tags, service worker registration

**Implementation:**
- **`manifest.json`**: `name: "pi-webhost"`, `display: "standalone"`, `background_color` and `theme_color` matching the zinc dark theme, icons at 192×192 and 512×512 (plus maskable variant).
- **`sw.js`**: Network-first strategy. Cache the app shell (HTML, CSS, JS) on install. On fetch, try network first, fall back to cache. Don't cache `/api/` or `/ws` requests. Show a simple offline message if both network and cache miss.
- **`index.html`**: Add `<link rel="manifest" href="/manifest.json">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="theme-color">`. Register the service worker in a `<script>` block.
- Generate icons from the existing `logo.svg` or create simple ones. The pi-webhost mark at multiple sizes.
- Add `<meta name="viewport">` if not already present (should be, given mobile layout work).

**Acceptance criteria:**
- Chrome/Safari show "Install" / "Add to Home Screen" option
- Installed app opens in standalone mode (no browser chrome)
- App shell loads from cache when server is unreachable, showing an offline message
- Service worker updates on deploy (versioned cache name)
- No interference with WebSocket connections or API requests
- Works on iOS Safari, Android Chrome, macOS Chrome/Arc

---

## 4. Voice Input

**Effort: Low** · **Impact: Medium** · **Source: [Tau](https://github.com/deflating/tau) `public/app.js`**

Mic button in the input area using Web Speech API for on-device dictation. Live transcription
into the textarea. Especially valuable on mobile where typing long prompts is painful.

### Task 4.1 — Mic button with Web Speech API

**Files:**
- `packages/web/src/components/Editor.tsx` — mic button, speech recognition logic

**Implementation:**
- Check for `window.SpeechRecognition || window.webkitSpeechRecognition` support. If absent, don't render the mic button.
- Add a mic icon button next to the send button.
- On click: start continuous recognition with `interimResults: true`. Append transcribed text to the existing textarea value in real-time.
- Button pulses red while recording (`animate-pulse bg-red-500/20`).
- Click again to stop. Final transcript commits to the textarea.
- On recognition error or unexpected end, stop cleanly and reset UI state.
- Language: default to `navigator.language` or `'en-US'`.

**Acceptance criteria:**
- Mic button visible on supported browsers, hidden on unsupported
- Click starts recording, live transcription appears in textarea
- Click again stops recording, text remains in textarea
- Button has clear visual state (pulsing red) while recording
- Works on mobile Safari and Chrome
- No errors when speech recognition is unavailable
- `npm run typecheck` passes

---

## 5. Command Palette

**Effort: Low-Medium** · **Impact: Medium** · **Source: [Tau](https://github.com/deflating/tau) `public/app.js`**

A Cmd+K style palette for power-user actions. Clean way to surface features without cluttering
the header or adding more buttons.

### Task 5.1 — Command palette overlay

**Files:**
- `packages/web/src/components/CommandPalette.tsx` — new file
- `packages/web/src/App.tsx` — render palette, keyboard shortcut listener
- `packages/web/src/hooks/useAgent.ts` — expose actions (compact, get_stats, etc.)

**Implementation:**
- Trigger: `Cmd+K` / `Ctrl+K` keyboard shortcut, or a button in the header.
- Overlay: centered modal with a search input and a filtered list of commands.
- Commands (initial set):
  - 🗜️ **Compact** — triggers context compaction for the active session
  - 📊 **Session Stats** — shows a stats summary (messages, tokens, cost)
  - 🔍 **Search** — opens the existing Cmd+F search
  - 🆕 **New Session** — opens the new session dialog
- Each command has an icon, label, and optional description.
- Type to filter commands. Arrow keys to navigate, Enter to execute, Escape to close.
- Extensible: commands defined as an array, easy to add more later.

**Acceptance criteria:**
- Cmd+K opens the palette, Escape closes it
- Typing filters the command list
- Arrow keys navigate, Enter executes
- Compact command triggers compaction on the active session
- Palette closes after executing a command
- Looks good in the existing dark theme

---

## 6. Tab Title Notifications

**Effort: Very Low** · **Impact: Low** · **Source: [Tau](https://github.com/deflating/tau) `public/app.js`**

When the browser tab is backgrounded, update the document title with an unread count as new
assistant messages arrive. Reset on focus.

### Task 6.1 — Unread count in tab title

**Files:**
- `packages/web/src/hooks/useAgent.ts` — track focus state, count new messages, update `document.title`

**Implementation:**
- Track `document.hasFocus()` and listen for `focus`/`blur` events on `window`.
- When the tab is blurred and new assistant messages arrive (or `agent_end` fires), increment a counter.
- Set `document.title` to `(3) pi-webhost` (with count prefix).
- On focus, reset counter and restore original title.
- Only count meaningful events (assistant messages, agent completion), not every streaming chunk.

**Acceptance criteria:**
- Backgrounded tab shows unread count in title
- Count resets on focus
- No flicker or rapid title updates during streaming
- Original title restored cleanly
