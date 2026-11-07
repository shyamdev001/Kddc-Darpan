"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatLoop } from "@/lib/format";
import { effectiveSec, issueOf, type DraftItem } from "./draft";

const TICK = 100;

/** Plays the loop the way a branch TV will: real timings, ended or unready items skipped. */
export function LoopPreview({ items, defaultImageSec, onClose }: { items: DraftItem[]; defaultImageSec: number; onClose: () => void }) {
  const playable = useMemo(() => items.filter((i) => issueOf(i.media) === null), [items]);
  const skipped = items.length - playable.length;
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const current = playable[index % Math.max(1, playable.length)];
  const duration = current ? effectiveSec(current, defaultImageSec) * 1000 : 0;

  const elapsedRef = useRef(0);
  const count = playable.length;

  function go(to: number) {
    if (!count) return;
    setIndex((to + count) % count);
    elapsedRef.current = 0;
    setElapsed(0);
  }

  // One clock drives the loop: advance when the item's time is up.
  useEffect(() => {
    if (paused || !count) return;
    const t = setInterval(() => {
      const next = elapsedRef.current + TICK;
      if (next >= duration) {
        elapsedRef.current = 0;
        setElapsed(0);
        setIndex((i) => (i + 1) % count);
      } else {
        elapsedRef.current = next;
        setElapsed(next);
      }
    }, TICK);
    return () => clearInterval(t);
  }, [paused, count, duration]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, index]);

  const loopSec = playable.reduce((s, i) => s + effectiveSec(i, defaultImageSec), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden bg-ink p-0 text-white ring-white/10 sm:max-w-5xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Playlist preview</DialogTitle>
        <DialogDescription className="sr-only">Plays the loop with the timings a branch screen uses.</DialogDescription>

        <div className="relative flex aspect-video items-center justify-center bg-black">
          {!current ? (
            <p className="px-8 text-center text-white/70">
              Nothing to play. Every item has ended, failed or is still processing, so a screen would show nothing.
            </p>
          ) : current.media.type === "VIDEO" ? (
            <video
              key={current.key + index}
              ref={video}
              src={current.media.fileUrl ?? undefined}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
            <img key={current.key + index} src={current.media.fileUrl ?? undefined} alt={current.media.displayName} className="h-full w-full object-contain animate-in fade-in duration-500" />
          )}
        </div>

        <div className="h-1 bg-white/10" aria-hidden>
          <div className="h-full bg-haldi" style={{ width: `${duration ? Math.min(100, (elapsed / duration) * 100) : 0}%` }} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1">
            <CtlButton label="Previous" onClick={() => go(index - 1)} disabled={!current}>
              <ChevronLeft />
            </CtlButton>
            <CtlButton label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)} disabled={!current}>
              {paused ? <Play /> : <Pause />}
            </CtlButton>
            <CtlButton label="Next" onClick={() => go(index + 1)} disabled={!current}>
              <ChevronRight />
            </CtlButton>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{current?.media.displayName ?? "Empty loop"}</p>
            <p className="text-sm text-white/60 tabular-nums">
              {current ? `${(index % playable.length) + 1} of ${playable.length}, loop ${formatLoop(loopSec)}` : ""}
              {skipped > 0 && `. ${skipped} skipped as a screen would`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
            Close preview
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CtlButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30 [&_svg]:size-5"
    >
      {children}
    </button>
  );
}
