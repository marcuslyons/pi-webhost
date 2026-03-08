import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type DragEvent, type ClipboardEvent } from "react";
import { useChatStore } from "../stores/chatStore";

// ── Speech recognition support ─────────────────────────────────────

const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition
    : undefined;

const hasSpeechSupport = !!SpeechRecognitionCtor;

interface PendingImage {
  id: string;
  data: string; // base64 data URL
  mimeType: string;
  preview: string; // data URL for thumbnail
}

interface QueuedMessage {
  id: number;
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
}

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

interface EditorProps {
  onSend: (message: string, images?: Array<{ data: string; mimeType: string }>) => void;
  onAbort: () => void;
}

let queueIdCounter = 0;

export function Editor({ onSend, onAbort }: EditorProps) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);
  const prevStreamingRef = useRef(isStreaming);

  const imageIdCounter = useRef(0);

  // ── Speech recognition ──────────────────────────────────────────

  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      // Stop recording
      recognitionRef.current?.stop();
      return;
    }

    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    // Track the text that existed before recording started
    const baseText = input;
    let finalizedText = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalizedText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      const separator = baseText && !baseText.endsWith(" ") ? " " : "";
      setInput(baseText + separator + finalizedText + interim);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [isRecording, input]);

  // Auto-flush queue when streaming stops
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      // Streaming just stopped — send the next queued message
      setMessageQueue((prev) => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        // Use setTimeout to avoid sending during render
        setTimeout(() => onSend(next.text, next.images), 0);
        return rest;
      });
    }
  }, [isStreaming, onSend]);

  const addImageFiles = useCallback(
    (files: FileList | File[]) => {
      setImageError(null);
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        if (!SUPPORTED_TYPES.has(file.type)) {
          setImageError(`Unsupported type: ${file.type}. Use PNG, JPEG, GIF, or WebP.`);
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          setImageError(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`);
          continue;
        }
        if (images.length >= MAX_IMAGES) {
          setImageError(`Max ${MAX_IMAGES} images per message.`);
          break;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64Data = dataUrl.split(",")[1];
          setImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev;
            return [
              ...prev,
              {
                id: `img-${++imageIdCounter.current}`,
                data: base64Data,
                mimeType: file.type,
                preview: dataUrl,
              },
            ];
          });
        };
        reader.readAsDataURL(file);
      }
    },
    [images.length],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    setImageError(null);
  }, []);

  const removeQueuedMessage = useCallback((id: number) => {
    setMessageQueue((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && SUPPORTED_TYPES.has(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);

      const files = e.dataTransfer?.files;
      if (files?.length) {
        const imageFiles = Array.from(files).filter((f) => SUPPORTED_TYPES.has(f.type));
        if (imageFiles.length > 0) {
          addImageFiles(imageFiles);
        }
      }
    },
    [addImageFiles],
  );

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && images.length === 0) return;

    const imagePayload = images.length > 0
      ? images.map((img) => ({ data: img.data, mimeType: img.mimeType }))
      : undefined;

    if (isStreaming) {
      // Queue the message instead of sending immediately
      setMessageQueue((prev) => [
        ...prev,
        { id: ++queueIdCounter, text: trimmed || "(image)", images: imagePayload },
      ]);
    } else {
      onSend(trimmed || "(image)", imagePayload);
    }

    setInput("");
    setImages([]);
    setImageError(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, images, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if ((e.key === "Escape" || (e.key === "c" && e.ctrlKey)) && isStreaming) {
        e.preventDefault();
        onAbort();
      }
    },
    [handleSubmit, isStreaming, onAbort],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/50 p-2 sm:p-4">
      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <img
                src={img.preview}
                alt="Attached"
                className="h-16 w-16 rounded-lg border border-zinc-700 object-cover"
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-all"
                title="Remove"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Image error */}
      {imageError && (
        <div className="mb-2 text-xs text-red-400">{imageError}</div>
      )}

      {/* Queued message pills */}
      {messageQueue.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {messageQueue.map((msg) => (
            <div
              key={msg.id}
              className="flex items-center gap-1.5 rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1 text-xs text-zinc-300 max-w-xs"
            >
              <span className="truncate">{msg.text}</span>
              <button
                onClick={() => removeQueuedMessage(msg.id)}
                className="shrink-0 rounded-full p-0.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                title="Remove from queue"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center gap-2 rounded-xl border bg-zinc-900 px-3 py-2 transition-colors ${
          dragOver
            ? "border-violet-500 bg-violet-500/5"
            : isStreaming
              ? "border-violet-500/40"
              : "border-zinc-700 focus-within:border-violet-500/60"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isStreaming
              ? "Type to queue a follow-up… (Escape to abort)"
              : "Type a message… (Shift+Enter for new line)"
          }
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          autoFocus
        />

        {/* Mic button — speech recognition */}
        {hasSpeechSupport && (
          <button
            onClick={toggleRecording}
            className={`shrink-0 rounded-lg p-2 transition-colors ${
              isRecording
                ? "animate-pulse bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
            title={isRecording ? "Stop recording" : "Start voice input"}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
            </svg>
          </button>
        )}

        {/* Abort button (only while streaming) */}
        {isStreaming && (
          <button
            onClick={onAbort}
            className="shrink-0 rounded-lg bg-red-900/50 p-2 text-red-300 hover:bg-red-900/80 transition-colors"
            title="Abort (Escape)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Send button (always visible, queues if streaming) */}
        <button
          onClick={handleSubmit}
          disabled={!input.trim() && images.length === 0}
          className={`shrink-0 rounded-lg p-2 transition-colors ${
            isStreaming
              ? "bg-violet-600/60 text-white hover:bg-violet-500/60 disabled:opacity-30 disabled:cursor-not-allowed"
              : "bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed"
          }`}
          title={isStreaming ? "Queue message" : "Send (Enter)"}
        >
          {isStreaming ? (
            // Queue icon (plus)
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          ) : (
            // Send icon (arrow)
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] text-zinc-600">
          {isStreaming
            ? `Shift+Enter for new line · Escape to abort · Messages will queue${messageQueue.length > 0 ? ` (${messageQueue.length} queued)` : ""}`
            : "Shift+Enter for new line · Escape to abort · Paste or drag images"}
        </span>
      </div>
    </div>
  );
}
