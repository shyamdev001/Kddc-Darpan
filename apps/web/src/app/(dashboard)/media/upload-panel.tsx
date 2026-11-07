"use client";

import { useRef, useState, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, Copy, Upload } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UploadEntry } from "./use-uploads";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

export function DropZone({ onFiles, compact }: { onFiles: (files: FileList) => void; compact: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-dashed border-input bg-card transition-colors",
        compact ? "flex-wrap px-5 py-4" : "flex-col px-6 py-14 text-center",
        over && "border-neel bg-neel-soft/50",
      )}
    >
      <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-neel-soft text-neel", compact ? "size-10" : "size-12")}>
        <Upload className="size-5" />
      </span>
      <div className={cn("min-w-0", compact && "min-w-[15rem] flex-1")}>
        <p className="font-medium">
          {over ? "Drop to upload" : compact ? "Drag posters and videos here" : "Drag posters and videos here to upload"}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          JPG, PNG or WebP up to 30 MB. MP4, MOV or WebM up to 500 MB. Gujarati file names are kept as they are.
        </p>
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          "inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-foreground hover:bg-primary/90",
          !compact && "mt-2",
        )}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function UploadList({ entries, onClear }: { entries: UploadEntry[]; onClear: () => void }) {
  if (!entries.length) return null;
  const finished = entries.filter((e) => e.state.phase !== "queued" && e.state.phase !== "uploading").length;

  return (
    <section aria-label="Uploads" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-sm font-medium tabular-nums">
          Uploads <span className="text-muted-foreground">{finished} of {entries.length} finished</span>
        </p>
        {finished > 0 && (
          <button type="button" onClick={onClear} className="text-sm text-muted-foreground hover:text-foreground">
            Clear finished
          </button>
        )}
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-3 px-5 py-2.5">
            <StatusIcon entry={e} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={e.name}>
                {e.name}
              </p>
              {e.state.phase === "uploading" && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-mist">
                  <div className="h-full bg-neel transition-[width]" style={{ width: `${Math.round(e.state.progress * 100)}%` }} />
                </div>
              )}
              {e.state.phase === "rejected" && <p className="text-sm text-destructive">{e.state.reason}</p>}
              {e.state.phase === "duplicate" && (
                <p className="text-sm text-muted-foreground">Already in the library as “{e.state.existingName}”. Not uploaded again.</p>
              )}
            </div>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {e.state.phase === "uploading" ? `${Math.round(e.state.progress * 100)}%` : e.state.phase === "queued" ? "Waiting" : formatBytes(e.size)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusIcon({ entry }: { entry: UploadEntry }) {
  const p = entry.state.phase;
  if (p === "done") return <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label="Uploaded" />;
  if (p === "duplicate") return <Copy className="size-4 shrink-0 text-muted-foreground" aria-label="Duplicate" />;
  if (p === "rejected") return <AlertCircle className="size-4 shrink-0 text-destructive" aria-label="Not uploaded" />;
  return <span className="size-4 shrink-0 animate-pulse rounded-full border-2 border-neel/40" aria-label="Uploading" />;
}
