# Extension UI Protocol — Research Findings

## Summary

The Pi SDK has a well-defined extension UI protocol. Extensions interact with users via `ctx.ui` methods (`select`, `confirm`, `input`, `editor`, `notify`, etc.). The mechanism for non-TUI modes (like our web UI) is the `ExtensionUIContext` interface — an adapter that each host environment implements.

**This is fully supported.** We don't need to invent anything. We implement `ExtensionUIContext`, call `session.bindExtensions({ uiContext })`, and extension UI requests flow through our implementation.

---

## How It Works

### Extension Side (unchanged)

Extensions call `ctx.ui.*` methods during event handlers or tool execution:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
    if (!ok) return { block: true, reason: "Blocked by user" };
  }
});
```

### Host Side (what we implement)

The `ExtensionUIContext` interface is the contract. Each method is either:
- **Dialog** (blocks until user responds): `select`, `confirm`, `input`, `editor`
- **Fire-and-forget** (no response needed): `notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`
- **TUI-specific** (no-op in web): `custom`, `setWorkingMessage`, `setFooter`, `setHeader`, `setEditorComponent`, `getToolsExpanded`, `setToolsExpanded`

### Binding

After `createAgentSession()`, call:

```typescript
await session.bindExtensions({
  uiContext: myWebUIContext,
  // optional: commandContextActions, shutdownHandler, onError
});
```

The `extensionsResult` from `createAgentSession()` contains loaded extensions. `bindExtensions` wires them up with our UI adapter.

---

## ExtensionUIContext Interface

Source: `@mariozechner/pi-coding-agent` → `ExtensionUIContext` type

### Dialog Methods (require response)

| Method | Signature | Returns |
|--------|-----------|---------|
| `select` | `(title: string, options: string[], opts?) → Promise<string \| undefined>` | Selected option or `undefined` if cancelled |
| `confirm` | `(title: string, message: string, opts?) → Promise<boolean>` | `true`/`false` |
| `input` | `(title: string, placeholder?: string, opts?) → Promise<string \| undefined>` | User text or `undefined` |
| `editor` | `(title: string, prefill?: string) → Promise<string \| undefined>` | Edited text or `undefined` |

All dialog methods accept optional `ExtensionUIDialogOptions`:
```typescript
{ signal?: AbortSignal; timeout?: number }
```

When `timeout` is set, the SDK auto-resolves with a default value (undefined/false) when time expires. The client doesn't need to track timeouts — but showing a countdown is a nice UX.

### Fire-and-Forget Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `notify` | `(message: string, type?: "info" \| "warning" \| "error")` | Toast notification |
| `setStatus` | `(key: string, text: string \| undefined)` | Persistent footer status |
| `setWidget` | `(key: string, content: string[] \| undefined, options?)` | Widget above/below editor |
| `setTitle` | `(title: string)` | Window title |
| `setEditorText` | `(text: string)` | Pre-fill editor |

### No-Op in Web Context

| Method | Why |
|--------|-----|
| `custom()` | Returns `undefined` — requires TUI component system |
| `setWorkingMessage()` | No-op — TUI loader concept |
| `setFooter()` | No-op — TUI-specific |
| `setHeader()` | No-op — TUI-specific |
| `setEditorComponent()` | No-op — TUI-specific |
| `getToolsExpanded()` | Returns `false` |
| `setToolsExpanded()` | No-op |
| `getAllThemes()` | Returns `[]` |
| `getTheme()` | Returns `undefined` |
| `setTheme()` | Returns `{ success: false, error: "..." }` |

### `theme` Property

Required. Returns a `Theme` object. We can use `initTheme()` from the SDK to create a default theme, or provide a stub. Extensions use `theme.fg("accent", text)` etc. for terminal styling — in our web context this is irrelevant since we render our own UI, but it must not throw.

---

## RPC Mode Reference Implementation

The RPC mode in `dist/modes/rpc/rpc-mode.js` implements `ExtensionUIContext` by:

1. Creating a `pendingExtensionRequests: Map<id, { resolve, reject }>` for dialog correlation
2. Dialog methods: generate a UUID, store the promise resolver, emit a JSON event on stdout, block on the promise
3. When a response arrives on stdin with matching `id`, resolve the promise
4. Fire-and-forget methods: emit JSON with a UUID, don't store any resolver

### RPC Event Shapes (from `rpc-types.d.ts`)

**Request** (server → client):
```typescript
type RpcExtensionUIRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
  | { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
```

**Response** (client → server):
```typescript
type RpcExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true }
```

---

## Implementation Plan

### Server (Task 7.2)

1. **Implement `ExtensionUIContext`** in a new file `packages/server/src/extensions/ui-context.ts`:
   - Dialog methods: generate UUID, store resolver in a map, send WS event to client, return promise
   - Fire-and-forget methods: send WS event, no resolver
   - Expose a `handleResponse(id, response)` method to resolve pending dialogs

2. **Call `session.bindExtensions()`** in `AgentManager.createSession()` and `openSession()` after creating the session. Pass the UI context. The UI context needs a reference to the WebSocket send function, which means it needs to be wired when the session is attached to a connection.

   Actually, better approach: create the UI context per-session but with a mutable `sender` function. When a WS connection sets up event forwarding for a session, it also sets the sender. This way the UI context is bound to the session, not the connection.

3. **Add `extension_ui_response` command** to `ClientCommand` in `handler.ts`. When received, look up the session, call `uiContext.handleResponse(requestId, response)`.

4. **Forward extension UI events** via the session's subscription. The extension UI requests don't come through `session.subscribe()` — they're emitted directly by our `ExtensionUIContext` implementation. So we emit them from within the UI context's methods.

### Client (Task 7.3)

1. **Add types** to `lib/types.ts` for extension UI requests/responses
2. **Add store state** for the current extension prompt (queue of pending prompts)
3. **Handle `extension_ui_request` events** in `useAgent.ts` — push to the prompt queue
4. **New component `ExtensionPrompt.tsx`** — modal overlay that renders the appropriate UI:
   - `select`: list of buttons
   - `confirm`: title + message + Yes/No buttons
   - `input`: title + text input + Submit/Cancel
   - `editor`: title + textarea + Submit/Cancel
   - `notify`: toast notification (non-blocking)
5. **Send `extension_ui_response`** when user responds

### Priority

For Task 7.3, support `confirm` and `select` first (most common: permission gates, tool approval). `input` and `editor` are secondary. `notify` is easy and useful.

---

## Complexity Assessment

- **Server**: Medium. The `ExtensionUIContext` implementation is ~100 lines following the RPC pattern. The tricky part is the sender lifecycle — the UI context outlives any single WS connection.
- **Client**: Low-Medium. Modal overlay with a few variants. The main complexity is the queue and proper cleanup.
- **SDK gaps**: None. The interface is fully exported and documented. `bindExtensions` is a public method on `AgentSession`.

---

## Current State

pi-webhost does NOT call `session.bindExtensions()`. Extensions are loaded (via `DefaultResourceLoader`) but have no UI context. If an extension calls `ctx.ui.confirm()`, it would fail because there's no UI context bound.

The `extensionsResult` from `createAgentSession()` is currently discarded in `AgentManager`. We need to call `bindExtensions` with our custom `ExtensionUIContext`.

---

## Key SDK Imports Needed

```typescript
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@mariozechner/pi-coding-agent";
import { initTheme } from "@mariozechner/pi-coding-agent";
```

`initTheme()` creates a default `Theme` object required by the `theme` property on `ExtensionUIContext`.
