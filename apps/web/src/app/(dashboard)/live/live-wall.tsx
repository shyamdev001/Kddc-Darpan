"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LiveScreen, LiveWallResponse } from "@darpan/shared";
import { MonitorOff, Radio, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "../empty-state";

/** TVs report each change as it happens; a few seconds of polling keeps the wall close behind. */
const REFRESH_MS = 3_000;

type Show = "all" | "online" | "broadcast" | "offline";
const SHOW: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Showing ads" },
  { value: "broadcast", label: "Broadcasting" },
  { value: "offline", label: "Offline" },
];

function stateOf(s: LiveScreen): Exclude<Show, "all"> {
  if (!s.online) return "offline";
  return s.broadcast ? "broadcast" : "online";
}

export function LiveWall() {
  const [data, setData] = useState<LiveWallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");

  useEffect(() => {
    let stopped = false;
    const load = () => {
      // Nobody is looking: skip, and catch up as soon as the tab is visible again.
      if (document.hidden) return;
      apiFetch<LiveWallResponse>("/api/screens/live")
        .then((d) => {
          if (stopped) return;
          setData(d);
          setNow(Date.now());
          setError(null);
        })
        .catch((e: Error) => !stopped && setError(e.message));
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: 0, online: 0, broadcast: 0, offline: 0 };
    for (const s of data?.items ?? []) {
      c.all++;
      c[stateOf(s)]++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (s) =>
        (show === "all" || stateOf(s) === show) &&
        (!q || [s.name, s.branch?.name, s.region?.name].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [data, query, show]);

  if (error && !data) {
    return (
      <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
        Could not load the live wall: {error}
      </p>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (!data.items.length) {
    return (
      <EmptyState icon={MonitorOff} title="No screens yet">
        Pair a TV on the Screens page and it appears here.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Which screens" className="flex flex-wrap gap-1.5">
          {SHOW.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={show === o.value}
              onClick={() => setShow(o.value)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                show === o.value ? "border-ink bg-ink text-white" : "border-input bg-card text-muted-foreground hover:bg-mist hover:text-foreground",
              )}
            >
              {o.label}
              <span className={cn("tabular-nums", show === o.value ? "text-white/70" : "text-muted-foreground/80")}>{counts[o.value]}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Find a screen or branch</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Screen, branch or region"
            className="h-9 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      </div>

      {error && <p className="text-sm text-destructive">Lost contact with the server. Showing what it last reported.</p>}

      {visible.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-5">
          {visible.map((s) => (
            <li key={s.id}>
              <Tile screen={s} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">No screens match.</p>
      )}
    </div>
  );
}

function Tile({ screen: s, now }: { screen: LiveScreen; now: number }) {
  const state = stateOf(s);
  return (
    <Link
      href={`/screens/${s.id}`}
      className="group block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`${s.name}: ${caption(s, now)}`}
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-lg bg-[#0b0f24] ring-1 transition-shadow group-hover:shadow-md",
          state === "broadcast" ? "ring-2 ring-[#c41e3a]" : "ring-ink/10",
        )}
      >
        <Picture screen={s} />
        {state === "broadcast" && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-[#c41e3a] px-1.5 py-0.5 text-[11px] font-semibold text-white">
            <Radio className="size-3" aria-hidden />
            Broadcast
          </span>
        )}
        {s.broadcast?.status?.startsWith("error") && (
          <span className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[11px] text-white">
            {s.broadcast.status.replace(/^error:\s*/, "Cannot play: ")}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-start gap-2 px-0.5">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            state === "offline" ? "bg-muted-foreground/40" : state === "broadcast" ? "bg-[#c41e3a]" : "bg-ok",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{s.name}</p>
          <p className="truncate text-xs text-muted-foreground">{caption(s, now)}</p>
        </div>
      </div>
    </Link>
  );
}

function caption(s: LiveScreen, now: number): string {
  const where = s.branch ? s.branch.name : "No branch";
  if (!s.online) return `${where}. Offline${s.lastSeenAt ? `, last seen ${formatAgo(s.lastSeenAt, now)}` : ""}`;
  if (s.broadcast) return `${where}. ${s.broadcast.title || (s.broadcast.kind === "LINK" ? "Live link" : "Broadcast")}`;
  if (s.nowPlaying) return `${where}. ${s.nowPlaying.displayName}`;
  return `${where}. Nothing playing`;
}

/** What is on the TV: the poster or video still, a broadcast's picture, or a quiet placeholder. */
function Picture({ screen: s }: { screen: LiveScreen }) {
  const b = s.broadcast;
  if (b?.mediaId) return <Thumb id={b.mediaId} />;
  if (b?.kind === "MESSAGE") {
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 bg-ink px-4">
        <span className="h-1 w-8 rounded-full bg-haldi" />
        {b.title && <p className="truncate text-xs font-semibold text-haldi">{b.title}</p>}
        <p className="line-clamp-3 text-sm leading-snug font-semibold text-white">{b.message}</p>
      </div>
    );
  }
  if (b) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-ink text-white">
        <Radio className="size-6 text-white/80" aria-hidden />
        <p className="text-xs font-medium text-white/80">{b.youtubeId ? "YouTube" : "Live stream"}</p>
      </div>
    );
  }
  if (s.nowPlaying) return <Thumb id={s.nowPlaying.id} />;
  return (
    <div className={cn("flex h-full items-center justify-center", !s.online && "opacity-60")}>
      <MonitorOff className="size-6 text-white/25" aria-hidden />
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
  return <img src={`/api/media/${id}/thumbnail`} alt="" className="h-full w-full object-contain" />;
}
