"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MediaItem, MediaListResponse } from "@darpan/shared";
import { Film, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { formatDuration, scheduleOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The media library, for adding items to the playlist. */
export function MediaPicker({ usage, onAdd }: { usage: Map<string, number>; onAdd: (m: MediaItem) => void }) {
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "IMAGE" | "VIDEO">("all");

  useEffect(() => {
    apiFetch<MediaListResponse>("/api/media")
      .then((r) => setMedia(r.items.filter((m) => m.status !== "FAILED")))
      .catch(() => setMedia([]));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().normalize("NFC").toLowerCase();
    return (media ?? []).filter(
      (m) => (type === "all" || m.type === type) && (!q || m.displayName.toLowerCase().includes(q) || m.originalName.toLowerCase().includes(q)),
    );
  }, [media, query, type]);

  return (
    <section aria-labelledby="picker-heading" className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4">
        <h2 id="picker-heading" className="font-heading text-lg font-semibold tracking-tight">
          Add from media
        </h2>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search media"
            className="h-9 bg-card pl-9"
          />
        </div>
        <div className="mt-3 flex gap-1 rounded-lg bg-mist p-1" role="tablist" aria-label="Media type">
          {(["all", "IMAGE", "VIDEO"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={type === t}
              onClick={() => setType(t)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-sm transition-colors",
                type === t ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all" ? "All" : t === "IMAGE" ? "Posters" : "Videos"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {media === null ? (
          <p className="p-3 text-sm text-muted-foreground">Loading media…</p>
        ) : media.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            The media library is empty.{" "}
            <Link href="/media" className="font-medium text-neel hover:underline">
              Upload posters first
            </Link>
            .
          </p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Nothing matches.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-2">
            {shown.map((m) => {
              const uses = usage.get(m.id) ?? 0;
              const ended = scheduleOf(m.startDate, m.endDate).kind === "expired";
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(m)}
                    className="group block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Add ${m.displayName}`}
                  >
                    <div className={cn("relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-ink", ended && "opacity-50")}>
                      {m.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
                        <img src={m.thumbUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                      ) : (
                        <span className="text-xs text-white/60">Processing</span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-neel/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        <Plus className="size-6 text-white" />
                      </span>
                      {m.type === "VIDEO" && m.durationSec !== null && (
                        <span className="absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/70 px-1 text-[11px] text-white tabular-nums">
                          <Film className="size-2.5" />
                          {formatDuration(m.durationSec)}
                        </span>
                      )}
                      {uses > 0 && (
                        <span className="absolute top-1 left-1 rounded bg-white px-1.5 text-[11px] font-medium text-neel">
                          Added{uses > 1 ? ` ×${uses}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm" title={m.displayName}>
                      {m.displayName}
                    </p>
                    {ended && <p className="text-xs text-[#8a5a00]">Ended</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
