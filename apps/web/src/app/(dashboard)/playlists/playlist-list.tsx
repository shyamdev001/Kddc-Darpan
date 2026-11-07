"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlaylistSummary } from "@darpan/shared";
import { AlertTriangle, ChevronRight, ListVideo } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { formatAgo, formatLoop } from "@/lib/format";
import { EmptyState } from "../empty-state";
import { NewPlaylistButton } from "./new-playlist-dialog";

export function PlaylistList() {
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PlaylistSummary[]>("/api/playlists")
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
        Could not load playlists: {error}
      </p>
    );
  }

  if (!items) {
    return (
      <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center gap-5 p-4">
            <div className="h-14 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    );
  }

  if (!items.length) {
    return (
      <EmptyState icon={ListVideo} title="No playlists yet">
        Create one, add posters and videos from the media library, and set how long each poster stays on
        screen. Then send it to a TV from the Screens page.
        <span className="mt-5 block">
          <NewPlaylistButton label="Create the first playlist" />
        </span>
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={`/playlists/${p.id}`} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-mist/60 sm:gap-6 sm:px-5">
            <Filmstrip previews={p.previews} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-lg font-semibold tracking-tight">{p.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                {p.itemCount === 0 ? "Empty" : `${p.itemCount} item${p.itemCount === 1 ? "" : "s"}, ${formatLoop(p.loopSec)} per loop`}
              </p>
              {p.attentionCount > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-[#8a5a00]">
                  <AlertTriangle className="size-3.5" />
                  {p.attentionCount} item{p.attentionCount === 1 ? " has" : "s have"} ended or failed and will be skipped
                </p>
              )}
            </div>
            <div className="hidden shrink-0 text-right text-sm sm:block">
              <p className={p.assignmentCount ? "font-medium text-ok" : "text-muted-foreground"}>
                {p.assignmentCount ? `On ${p.assignmentCount} target${p.assignmentCount === 1 ? "" : "s"}` : "Not on any screen"}
              </p>
              <p className="mt-0.5 text-muted-foreground">Edited {formatAgo(p.updatedAt)}</p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** First few thumbnails as a strip of tiny screens. */
function Filmstrip({ previews }: { previews: string[] }) {
  const slots = [0, 1, 2];
  return (
    <div className="hidden shrink-0 gap-1 sm:flex" aria-hidden>
      {slots.map((i) => (
        <div key={i} className="flex aspect-video w-[72px] items-center justify-center overflow-hidden rounded bg-ink">
          {previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
            <img src={previews[i]} alt="" className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <span className="size-1 rounded-full bg-white/20" />
          )}
        </div>
      ))}
    </div>
  );
}
