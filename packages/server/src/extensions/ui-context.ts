/**
 * Web-based ExtensionUIContext implementation.
 *
 * Translates extension UI requests (ctx.ui.select, ctx.ui.confirm, etc.)
 * into WebSocket events sent to the browser client, and resolves promises
 * when the client sends back responses.
 *
 * Follows the same pattern as Pi's RPC mode implementation.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@mariozechner/pi-coding-agent";
import { initTheme, Theme } from "@mariozechner/pi-coding-agent";

// Ensure the global theme is initialized (creates a default dark theme)
initTheme();

/** Function signature for sending data to the WS client. */
export type WSSender = (data: unknown) => void;

interface PendingDialog {
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/**
 * Create an ExtensionUIContext that forwards UI requests over WebSocket.
 *
 * The `sender` can be set/cleared as WS connections attach/detach.
 * Dialog methods block until the client responds or are cancelled.
 * If no sender is available, dialogs resolve with default values.
 */
export class WebExtensionUIContext implements ExtensionUIContext {
  private _sender: WSSender | null = null;
  private _sessionId: string;
  private _pendingDialogs = new Map<string, PendingDialog>();
  private _theme: Theme;

  constructor(sessionId: string) {
    this._sessionId = sessionId;
    // Use the global initialized theme
    this._theme = new Theme(
      // Provide a minimal color map — extensions use theme for TUI rendering
      // which doesn't apply in the web UI. Values don't matter, just don't throw.
      Object.fromEntries([
        "text", "accent", "muted", "dim", "success", "error", "warning",
        "toolTitle", "toolBorder", "toolBg", "toolTitleBg",
        "thinkingBorder", "thinkingBorderMinimal", "thinkingBorderLow",
        "thinkingBorderMedium", "thinkingBorderHigh", "thinkingBorderXhigh",
        "keyword", "string", "number", "comment", "function", "type",
        "operator", "variable", "punctuation", "regex", "constant",
        "added", "removed", "diffHeader",
      ].map(k => [k, ""])) as any,
      Object.fromEntries([
        "toolBg", "toolTitleBg",
      ].map(k => [k, ""])) as any,
      "dark" as any,
    );
  }

  /** Set the WebSocket sender function (called when a connection attaches). */
  setSender(sender: WSSender): void {
    this._sender = sender;
  }

  /** Clear the sender (called when a connection detaches). */
  clearSender(): void {
    this._sender = null;
    // Cancel all pending dialogs — no one to respond
    for (const [id, pending] of this._pendingDialogs) {
      pending.cleanup();
    }
  }

  /** Whether a sender is currently attached. */
  get hasSender(): boolean {
    return this._sender !== null;
  }

  /**
   * Handle a response from the client for a pending dialog.
   * Called by the WS handler when it receives an extension_ui_response command.
   */
  handleResponse(requestId: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): boolean {
    const pending = this._pendingDialogs.get(requestId);
    if (!pending) return false;
    pending.resolve(response);
    this._pendingDialogs.delete(requestId);
    return true;
  }

  /** Cancel all pending dialogs (e.g., on session destroy). */
  cancelAll(): void {
    for (const [id, pending] of this._pendingDialogs) {
      pending.cleanup();
    }
    this._pendingDialogs.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────

  private _send(data: unknown): void {
    if (this._sender) {
      this._sender(data);
    }
  }

  private _createDialogPromise<T>(
    opts: ExtensionUIDialogOptions | undefined,
    defaultValue: T,
    request: Record<string, unknown>,
    parseResponse: (response: any) => T,
  ): Promise<T> {
    if (!this._sender) {
      // No client connected — return default (same as print mode)
      return Promise.resolve(defaultValue);
    }

    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this._pendingDialogs.delete(id);
        resolve(defaultValue);
      };

      // Handle AbortSignal from extension
      if (opts?.signal) {
        if (opts.signal.aborted) {
          resolve(defaultValue);
          return;
        }
        opts.signal.addEventListener("abort", cleanup, { once: true });
      }

      // Handle timeout
      if (opts?.timeout) {
        timeoutId = setTimeout(cleanup, opts.timeout);
      }

      this._pendingDialogs.set(id, {
        resolve: (response: any) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(parseResponse(response));
        },
        reject,
        cleanup,
      });

      this._send({
        type: "extension_ui_request",
        sessionId: this._sessionId,
        id,
        ...request,
      });
    });
  }

  // ── Dialog methods ──────────────────────────────────────────────

  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    return this._createDialogPromise(
      opts,
      undefined,
      { method: "select", title, options, timeout: opts?.timeout },
      (r) => ("cancelled" in r && r.cancelled) ? undefined : ("value" in r ? r.value : undefined),
    );
  }

  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    return this._createDialogPromise(
      opts,
      false,
      { method: "confirm", title, message, timeout: opts?.timeout },
      (r) => ("cancelled" in r && r.cancelled) ? false : ("confirmed" in r ? r.confirmed : false),
    );
  }

  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    return this._createDialogPromise(
      opts,
      undefined,
      { method: "input", title, placeholder, timeout: opts?.timeout },
      (r) => ("cancelled" in r && r.cancelled) ? undefined : ("value" in r ? r.value : undefined),
    );
  }

  async editor(title: string, prefill?: string): Promise<string | undefined> {
    if (!this._sender) return undefined;

    const id = randomUUID();
    return new Promise<string | undefined>((resolve, reject) => {
      this._pendingDialogs.set(id, {
        resolve: (response: any) => {
          if ("cancelled" in response && response.cancelled) {
            resolve(undefined);
          } else if ("value" in response) {
            resolve(response.value);
          } else {
            resolve(undefined);
          }
        },
        reject,
        cleanup: () => {
          this._pendingDialogs.delete(id);
          resolve(undefined);
        },
      });

      this._send({
        type: "extension_ui_request",
        sessionId: this._sessionId,
        id,
        method: "editor",
        title,
        prefill,
      });
    });
  }

  // ── Fire-and-forget methods ─────────────────────────────────────

  notify(message: string, type?: "info" | "warning" | "error"): void {
    this._send({
      type: "extension_ui_request",
      sessionId: this._sessionId,
      id: randomUUID(),
      method: "notify",
      message,
      notifyType: type ?? "info",
    });
  }

  setStatus(key: string, text: string | undefined): void {
    this._send({
      type: "extension_ui_request",
      sessionId: this._sessionId,
      id: randomUUID(),
      method: "setStatus",
      statusKey: key,
      statusText: text,
    });
  }

  setWidget(key: string, content: any, options?: any): void {
    // Only support string arrays (same as RPC mode)
    if (content === undefined || Array.isArray(content)) {
      this._send({
        type: "extension_ui_request",
        sessionId: this._sessionId,
        id: randomUUID(),
        method: "setWidget",
        widgetKey: key,
        widgetLines: content,
        widgetPlacement: options?.placement,
      });
    }
  }

  setTitle(title: string): void {
    this._send({
      type: "extension_ui_request",
      sessionId: this._sessionId,
      id: randomUUID(),
      method: "setTitle",
      title,
    });
  }

  setEditorText(text: string): void {
    this._send({
      type: "extension_ui_request",
      sessionId: this._sessionId,
      id: randomUUID(),
      method: "set_editor_text",
      text,
    });
  }

  // ── No-op / stub methods (TUI-specific, not applicable to web) ──

  onTerminalInput(_handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void {
    // Raw terminal input not applicable to web mode
    return () => {};
  }
  setWorkingMessage(_message?: string): void {}
  setFooter(_factory: any): void {}
  setHeader(_factory: any): void {}
  async custom<T>(): Promise<T> { return undefined as T; }
  pasteToEditor(text: string): void { this.setEditorText(text); }
  getEditorText(): string { return ""; }
  setEditorComponent(_factory: any): void {}
  get theme(): Theme { return this._theme; }
  getAllThemes(): { name: string; path: string | undefined }[] { return []; }
  getTheme(_name: string): any { return undefined; }
  setTheme(_theme: any): { success: boolean; error?: string } {
    return { success: false, error: "Theme switching not supported in web mode" };
  }
  getToolsExpanded(): boolean { return false; }
  setToolsExpanded(_expanded: boolean): void {}
}
