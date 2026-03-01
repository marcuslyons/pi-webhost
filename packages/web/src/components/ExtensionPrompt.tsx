/**
 * Extension UI prompt overlay.
 *
 * Renders a modal for extension dialog requests (select, confirm, input, editor).
 * Dialogs are queued and shown one at a time. Also renders toast notifications.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import type { ExtensionUIDialog } from "../lib/types";

interface ExtensionPromptProps {
  agent: {
    sendExtensionUIResponse: (
      sessionId: string,
      requestId: string,
      response: { value?: string; confirmed?: boolean; cancelled?: boolean },
    ) => void;
  };
}

export function ExtensionPrompt({ agent }: ExtensionPromptProps) {
  const dialog = useChatStore((s) => s.extensionDialogQueue[0] ?? null);
  const notifications = useChatStore((s) => s.extensionNotifications);
  const removeNotification = useChatStore((s) => s.removeExtensionNotification);

  return (
    <>
      {/* Notifications toast stack */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm ${
                n.notifyType === "error"
                  ? "border-red-800 bg-red-950/90 text-red-200"
                  : n.notifyType === "warning"
                    ? "border-amber-800 bg-amber-950/90 text-amber-200"
                    : "border-zinc-700 bg-zinc-900/90 text-zinc-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span>{n.message}</span>
                <button
                  onClick={() => removeNotification(n.id)}
                  className="text-zinc-500 hover:text-zinc-300 shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog modal */}
      {dialog && (
        <DialogOverlay dialog={dialog} agent={agent} />
      )}
    </>
  );
}

function DialogOverlay({
  dialog,
  agent,
}: {
  dialog: ExtensionUIDialog;
  agent: ExtensionPromptProps["agent"];
}) {
  const respond = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      agent.sendExtensionUIResponse(dialog.sessionId, dialog.id, response);
    },
    [agent, dialog.sessionId, dialog.id],
  );

  const cancel = useCallback(() => {
    respond({ cancelled: true });
  }, [respond]);

  // Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancel]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {dialog.method === "confirm" && (
          <ConfirmDialog dialog={dialog} respond={respond} cancel={cancel} />
        )}
        {dialog.method === "select" && (
          <SelectDialog dialog={dialog} respond={respond} cancel={cancel} />
        )}
        {dialog.method === "input" && (
          <InputDialog dialog={dialog} respond={respond} cancel={cancel} />
        )}
        {dialog.method === "editor" && (
          <EditorDialog dialog={dialog} respond={respond} cancel={cancel} />
        )}
      </div>
    </div>
  );
}

// ── Confirm ─────────────────────────────────────────────────────────

function ConfirmDialog({
  dialog,
  respond,
  cancel,
}: {
  dialog: Extract<ExtensionUIDialog, { method: "confirm" }>;
  respond: (r: { confirmed?: boolean; cancelled?: boolean }) => void;
  cancel: () => void;
}) {
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    yesRef.current?.focus();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-zinc-100 mb-2">{dialog.title}</h2>
      <p className="text-sm text-zinc-400 mb-6">{dialog.message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={cancel}
          className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          ref={yesRef}
          onClick={() => respond({ confirmed: true })}
          className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

// ── Select ──────────────────────────────────────────────────────────

function SelectDialog({
  dialog,
  respond,
  cancel,
}: {
  dialog: Extract<ExtensionUIDialog, { method: "select" }>;
  respond: (r: { value?: string; cancelled?: boolean }) => void;
  cancel: () => void;
}) {
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((i) => Math.min(i + 1, dialog.options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        respond({ value: dialog.options[highlighted] });
      }
    },
    [dialog.options, highlighted, respond],
  );

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-zinc-100 mb-4">{dialog.title}</h2>
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-1 mb-4 max-h-64 overflow-y-auto outline-none"
      >
        {dialog.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => respond({ value: opt })}
            className={`text-left px-3 py-2 text-sm rounded-lg transition-colors ${
              i === highlighted
                ? "bg-violet-600/30 text-violet-200 border border-violet-500/50"
                : "text-zinc-300 hover:bg-zinc-800 border border-transparent"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={cancel}
          className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Input ───────────────────────────────────────────────────────────

function InputDialog({
  dialog,
  respond,
  cancel,
}: {
  dialog: Extract<ExtensionUIDialog, { method: "input" }>;
  respond: (r: { value?: string; cancelled?: boolean }) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    respond({ value });
  }, [value, respond]);

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-zinc-100 mb-4">{dialog.title}</h2>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={dialog.placeholder}
        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 mb-4"
      />
      <div className="flex justify-end gap-3">
        <button
          onClick={cancel}
          className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────

function EditorDialog({
  dialog,
  respond,
  cancel,
}: {
  dialog: Extract<ExtensionUIDialog, { method: "editor" }>;
  respond: (r: { value?: string; cancelled?: boolean }) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState(dialog.prefill ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    respond({ value });
  }, [value, respond]);

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-zinc-100 mb-4">{dialog.title}</h2>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 mb-4 resize-y font-mono"
      />
      <div className="flex justify-end gap-3">
        <button
          onClick={cancel}
          className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
