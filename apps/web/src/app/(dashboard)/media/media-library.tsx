"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { goToSignInExpired } from "@/lib/session-expired";
import type { MediaItem, MediaListResponse } from "@darpan/shared";
import { Images, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MediaDialog } from "./media-dialog";
import { MediaTile } from "./media-tile";
import { DropZone, UploadList } from "./upload-panel";
import { useUploads } from "./use-uploads";

type Filter = "all" | "IMAGE" | "VIDEO" | "FAILED";

export function MediaLibrary() {
  const [data, setData] = useState<MediaListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    if (filter === "IMAGE" || filter === "VIDEO") params.set("type", filter);
    if (filter === "FAILED") params.set("status", "FAILED");
    try {
      const res = await fetch(`/api/media?${params}`);
      if (res.status === 401) {
        goToSignInExpired();
        return;
      }
      if (!res.ok) throw new Error(`error ${res.status}`);
      setData(await res.json());
      setLoadError(null);
    } catch {
      setLoadError("Could not load the media library. Check that the API is running.");
    }
  }, [debounced, filter]);

  // Fetch when the search or filter changes. State is only set after the request resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching; setState runs after await
    void load();
  }, [load]);

  const uploads = useUploads(load);

  // While anything is being processed, refresh every few seconds so tiles update on their own.
  const processing = (data?.counts.processing ?? 0) > 0;
  useEffect(() => {
    if (!processing && !uploads.busy) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [processing, uploads.busy, load]);

  const openItem = useMemo<MediaItem | null>(() => data?.items.find((m) => m.id === openId) ?? null, [data, openId]);
  const counts = data?.counts;
  const isEmptyLibrary = counts?.all === 0;

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All", count: counts?.all },
    { id: "IMAGE", label: "Images", count: counts?.images },
    { id: "VIDEO", label: "Videos", count: counts?.videos },
    ...(counts?.failed ? [{ id: "FAILED" as const, label: "Failed", count: counts.failed }] : []),
  ];

  return (
    <div className="grid gap-6">
      <DropZone onFiles={uploads.add} compact={!isEmptyLibrary} />
      <UploadList entries={uploads.entries} onClear={uploads.clearFinished} />

      {!isEmptyLibrary && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Filter media" className="flex gap-1 overflow-x-auto rounded-lg bg-mist p-1 [scrollbar-width:none]">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  filter === f.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                  f.id === "FAILED" && filter !== f.id && "text-destructive",
                )}
              >
                {f.label}
                {f.count !== undefined && <span className="text-muted-foreground tabular-nums">{f.count}</span>}
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search media by name"
              className="h-9 bg-card pl-9"
            />
          </div>
        </div>
      )}

      {loadError && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {data === null && !loadError ? (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <div className="aspect-video animate-pulse rounded-lg bg-muted" />
              <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : data && data.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 xl:grid-cols-4">
          {data.items.map((item) => (
            <MediaTile key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
          ))}
        </ul>
      ) : data && !isEmptyLibrary ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Images className="size-6 text-muted-foreground" />
          <p className="font-medium">Nothing matches {debounced ? `“${debounced}”` : "this filter"}</p>
          <button
            type="button"
            className="text-sm text-neel hover:underline"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Show all media
          </button>
        </div>
      ) : null}

      <MediaDialog item={openItem} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
