"use client";

import type { MediaItem } from "@darpan/shared";
import { AlertTriangle, Film, ImageIcon, Loader2 } from "lucide-react";
import { formatBytes, formatDuration, scheduleOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A media item shown the way a branch TV would show it: on a dark 16:9 screen. */
export function MediaTile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const schedule = scheduleOf(item.startDate, item.endDate);
  const portrait = (item.height ?? 0) > (item.width ?? 0);
  const busy = item.status === "UPLOADED" || item.status === "PROCESSING";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group block w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <div
          className={cn(
            "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-ink ring-1 ring-ink/5 transition-shadow group-hover:shadow-[0_8px_24px_-10px_rgba(20,25,54,0.45)]",
            schedule.kind === "expired" && "opacity-60",
          )}
        >
          {item.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not optimisable by next/image
            <img
              src={item.thumbUrl}
              alt=""
              loading="lazy"
              className={cn("h-full", portrait ? "w-auto" : "w-full object-contain")}
            />
          ) : busy ? (
            <span className="flex flex-col items-center gap-2 text-sm text-white/70">
              <Loader2 className="size-5 animate-spin" />
              {item.status === "UPLOADED" ? "Waiting to process" : item.type === "VIDEO" ? "Converting video" : "Preparing image"}
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 text-center text-sm text-white/80">
              <AlertTriangle className="size-5 text-haldi" />
              Could not process
            </span>
          )}

          {item.type === "VIDEO" && item.durationSec !== null && (
            <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
              {formatDuration(item.durationSec)}
            </span>
          )}
          {schedule.kind !== "none" && (
            <span
              className={cn(
                "absolute top-2 left-2 rounded px-1.5 py-0.5 text-xs font-medium",
                schedule.kind === "expired" && "bg-white/90 text-ink",
                schedule.kind === "ending" && "bg-haldi text-ink",
                schedule.kind === "upcoming" && "bg-white/90 text-neel",
                schedule.kind === "live" && "bg-black/60 text-white",
              )}
            >
              {schedule.label}
            </span>
          )}
        </div>

        <div className="mt-2.5 px-0.5">
          <p className="truncate font-medium" title={item.displayName}>
            {item.displayName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {item.type === "VIDEO" ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
            <span className="tabular-nums">
              {item.status === "FAILED"
                ? "Failed. Open for details"
                : item.width
                  ? `${item.width}×${item.height}, ${formatBytes(item.sizeBytes)}`
                  : formatBytes(item.sizeBytes)}
            </span>
          </p>
        </div>
      </button>
    </li>
  );
}
