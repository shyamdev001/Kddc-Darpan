"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlaylistSource, ScreenListResponse } from "@darpan/shared";
import { ChevronRight, MonitorPlay } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { formatAgo } from "@/lib/format";
import { EmptyState } from "../empty-state";
import { PairScreenButton } from "./pair-screen-dialog";
import { ScreenGlyph, ScreenStatusText } from "./screen-glyph";

/** Online status comes from the last time each TV checked in, so refresh the list regularly. */
const REFRESH_MS = 30_000;

export const SOURCE_TEXT: Record<PlaylistSource, string> = {
  SCREEN: "",
  BRANCH: "from its branch",
  TALUKA: "from its taluka",
  REGION: "from its region",
  ALL: "from all screens",
};

export function ScreenList() {
  const [data, setData] = useState<ScreenListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // set with each fetch; Date.now() is not allowed during prerender

  useEffect(() => {
    const load = () =>
      apiFetch<ScreenListResponse>("/api/screens")
        .then((d) => {
          setData(d);
          setNow(Date.now());
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (error && !data) {
    return (
      <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
        Could not load screens: {error}
      </p>
    );
  }

  if (!data) {
    return (
      <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center gap-5 p-4">
            <div className="aspect-video w-[88px] animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    );
  }

  const { items, waitingToPair } = data;
  const online = items.filter((s) => s.online).length;
  const needsPairing = items.filter((s) => !s.paired).length;

  return (
    <div className="grid gap-4">
      {waitingToPair > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-haldi/40 bg-[#fdf6e7] px-4 py-3 sm:px-5">
          <p className="text-[15px] text-[#6b4600]">
            <span className="font-medium">
              {waitingToPair} TV{waitingToPair === 1 ? " is" : "s are"} showing a pairing code.
            </span>{" "}
            Pair {waitingToPair === 1 ? "it" : "them"} with the code on the screen.
          </p>
          <PairScreenButton label="Enter code" />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={MonitorPlay} title="No screens paired yet">
          When the Darpan app first starts on a TV it shows a 6-digit code. Pair the screen with that code, choose
          its branch, and give it a playlist.
          {waitingToPair === 0 && (
            <span className="mt-5 block">
              <PairScreenButton label="Pair the first screen" />
            </span>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {online} of {items.length} online
            {needsPairing > 0 && `, ${needsPairing} need${needsPairing === 1 ? "s" : ""} pairing again`}
            {error && <span className="ml-2 text-destructive">Refresh failed; showing the last known state.</span>}
          </p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {items.map((s) => (
              <li key={s.id}>
                <Link href={`/screens/${s.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-mist/60 sm:gap-5 sm:px-5">
                  <ScreenGlyph screen={s} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-lg font-semibold tracking-tight">{s.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{s.branch?.name ?? "No branch"}</p>
                    <p className="mt-0.5 text-sm sm:hidden">
                      <ScreenStatusText screen={s} ago={s.lastSeenAt ? formatAgo(s.lastSeenAt, now) : null} />
                    </p>
                  </div>
                  <div className="hidden w-44 shrink-0 text-sm lg:block">
                    {s.playlist ? (
                      <>
                        <p className="truncate font-medium">{s.playlist.name}</p>
                        {s.playlist.source !== "SCREEN" && <p className="text-muted-foreground">{SOURCE_TEXT[s.playlist.source]}</p>}
                      </>
                    ) : (
                      <p className="text-[#8a5a00]">No playlist</p>
                    )}
                  </div>
                  <div className="hidden w-48 shrink-0 text-sm sm:block">
                    <ScreenStatusText screen={s} ago={s.lastSeenAt ? formatAgo(s.lastSeenAt, now) : null} />
                    {s.online && s.nowPlaying && <p className="mt-0.5 truncate text-muted-foreground">Showing {s.nowPlaying.displayName}</p>}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
