"use client";

import { IMAGE_SEC_MAX, IMAGE_SEC_MIN } from "@darpan/shared";
import { ArrowDown, ArrowUp, Film, GripVertical, X } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { effectiveSec, issueOf, type DraftItem } from "./draft";

const ISSUE_TEXT = {
  failed: "Failed processing. Skipped on screens.",
  processing: "Still processing. Plays once ready.",
  ended: "Ad has ended. Skipped on screens.",
  upcoming: "Not started yet. Plays from its first day.",
} as const;

interface Props {
  item: DraftItem;
  index: number;
  count: number;
  defaultImageSec: number;
  dragging: boolean;
  dropBefore: boolean;
  onDuration: (sec: number | null) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (before: boolean) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

export function ItemRow(p: Props) {
  const { item, index, count } = p;
  const m = item.media;
  const issue = issueOf(m);
  const isVideo = m.type === "VIDEO";

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.key);
        p.onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        p.onDragOver(e.clientY < rect.top + rect.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // the list also handles drop; move only once
        p.onDrop();
      }}
      onDragEnd={p.onDragEnd}
      className={cn(
        "relative flex flex-wrap items-center gap-x-3 gap-y-1 bg-card px-3 py-2.5 sm:flex-nowrap sm:gap-4 sm:px-4",
        p.dragging && "opacity-40",
        issue &&
          issue !== "upcoming" &&
          issue !== "processing" &&
          "bg-[#fdf6e7]",
      )}
    >
      {p.dropBefore && (
        <span
          aria-hidden
          className="absolute inset-x-0 -top-px h-0.5 bg-neel"
        />
      )}

      <span
        className="hidden cursor-grab text-muted-foreground active:cursor-grabbing sm:block"
        aria-hidden
      >
        <GripVertical className="size-4" />
      </span>
      <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
        {index + 1}
      </span>

      <div className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-ink sm:w-28">
        {m.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
          <img
            src={m.thumbUrl}
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-xs text-white/60">
            {m.status === "FAILED" ? "Failed" : "Processing"}
          </span>
        )}
        {isVideo && (
          <Film className="absolute bottom-1 left-1 size-3 text-white/80" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={m.displayName}>
          {m.displayName}
        </p>
        {issue ? (
          <p
            className={cn(
              "text-sm",
              issue === "upcoming" || issue === "processing"
                ? "text-muted-foreground"
                : "text-[#8a5a00]",
            )}
          >
            {ISSUE_TEXT[issue]}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isVideo ? "Video" : "Poster"}
          </p>
        )}
      </div>

      {/* Duration and actions: a second line on phones */}
      <div className="flex shrink-0 items-center gap-3 max-sm:basis-full max-sm:justify-end sm:contents">
        <div className="flex shrink-0 items-center gap-1.5">
          {isVideo ? (
            <span
              className="text-sm text-muted-foreground tabular-nums"
              title="Videos play to the end"
            >
              {formatDuration(effectiveSec(item, p.defaultImageSec))}
            </span>
          ) : (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="sr-only">
                Seconds on screen for {m.displayName}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={IMAGE_SEC_MIN}
                max={IMAGE_SEC_MAX}
                value={item.durationSec ?? ""}
                placeholder={String(p.defaultImageSec)}
                onChange={(e) => {
                  const v = e.target.value;
                  p.onDuration(
                    v === "" ? null : Math.max(0, Math.round(Number(v))),
                  );
                }}
                className={cn(
                  "h-8 w-16 rounded-md border border-input bg-card px-2 text-right text-foreground tabular-nums placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  item.durationSec !== null && "border-neel/50 bg-neel-soft/40",
                )}
              />
              s
            </label>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          <IconButton
            label="Move up"
            disabled={index === 0}
            onClick={() => p.onMove(index - 1)}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label="Move down"
            disabled={index === count - 1}
            onClick={() => p.onMove(index + 1)}
          >
            <ArrowDown />
          </IconButton>
          <IconButton
            label={`Remove ${m.displayName}`}
            onClick={p.onRemove}
            danger
          >
            <X />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:opacity-30 [&_svg]:size-4",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-mist hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
