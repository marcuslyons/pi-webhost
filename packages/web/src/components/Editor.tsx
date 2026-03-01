import { useCallback, useRef, useState, type KeyboardEvent, type DragEvent, type ClipboardEvent } from "react";
import { useChatStore } from "../stores/chatStore";

interface PendingImage {
  id: string;
  data: string; // base64 data URL
  mimeType: string;
  preview: string; // data URL for thumbnail
}

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

interface EditorProps {
  onSend: (message: string, images?: Array<{ data: string; mimeType: string }>) => void;
  onAbort: () => void;
}

export function Editor({ onSend, onAbort }: EditorProps) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.activeIsStreaming);

  let imageIdCounter = useRef(0);

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
          // Strip the data:image/...;base64, prefix for the server payload
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

    onSend(trimmed || "(image)", imagePayload);
    setInput("");
    setImages([]);
    setImageError(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, images, onSend]);

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
    <div className="border-t border-zinc-800 bg-zinc-900/50 p-4">
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
              ? "Type to queue a follow-up... (Escape to abort)"
              : "Type a message... (Shift+Enter for new line)"
          }
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          autoFocus
        />

        {/* Send / Abort button */}
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="shrink-0 rounded-lg bg-red-900/50 p-2 text-red-300 hover:bg-red-900/80 transition-colors"
            title="Abort (Escape)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim() && images.length === 0}
            className="shrink-0 rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] text-zinc-600">
          Shift+Enter for new line · Escape to abort · Paste or drag images
        </span>
      </div>
    </div>
  );
}
