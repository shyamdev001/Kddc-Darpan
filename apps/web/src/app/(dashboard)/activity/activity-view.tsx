"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ActivityEntry, ActivityResponse } from "@darpan/shared";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Plain words for each recorded action. Unknown ones show their code. */
const ACTION_TEXT: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "auth.password_change": "Changed own password",
  "auth.password_change_failed": "Wrong current password when changing it",
  "auth.2fa_enable": "Turned on two-step sign-in",
  "auth.2fa_disable": "Turned off two-step sign-in",
  "auth.2fa_failed": "Wrong two-step sign-in code",
  "user.reset_2fa": "Turned off someone's two-step sign-in",
  "user.create": "Added a person",
  "user.update": "Changed a person's account",
  "user.activate": "Turned an account on",
  "user.deactivate": "Turned an account off",
  "user.reset_password": "Set a new password for someone",
  "media.upload": "Uploaded media",
  "media.update": "Changed media details",
  "media.delete": "Deleted media",
  "media.retry": "Retried media processing",
  "playlist.create": "Created a playlist",
  "playlist.update": "Changed a playlist",
  "playlist.duplicate": "Copied a playlist",
  "playlist.delete": "Deleted a playlist",
  "screen.claim": "Paired a screen",
  "screen.claim_failed": "Wrong pairing code",
  "screen.repair": "Re-paired a screen",
  "screen.reregister": "Screen registered again",
  "screen.update": "Changed a screen",
  "screen.assign_playlist": "Set a screen's playlist",
  "screen.remove": "Removed a screen",
  "place.assign_playlist": "Set a playlist for an area",
  "region.create": "Added a region",
  "region.update": "Renamed a region",
  "region.remove": "Removed a region",
  "taluka.create": "Added a taluka",
  "taluka.update": "Changed a taluka",
  "taluka.remove": "Removed a taluka",
  "branch.create": "Added a branch",
  "branch.update": "Changed a branch",
  "branch.remove": "Removed a branch",
  "branch.import": "Imported branches",
  "schedule.create": "Added a timed playlist",
  "schedule.update": "Changed a timed playlist",
  "schedule.remove": "Removed a timed playlist",
  "display_hours.set": "Set screen on/off hours",
  "broadcast.start": "Started a broadcast",
  "broadcast.stop": "Stopped a broadcast",
  "alert_settings.update": "Changed alert settings",
  "alert_settings.test_email": "Sent a test alert email",
  "release.upload": "Uploaded an app version",
  "release.update": "Changed an app version",
  "release.delete": "Deleted an app version",
  "release.test_screens": "Changed the test screens",
  "release.stage.all": "Released an app version to all screens",
  "release.stage.test": "Offered an app version to test screens",
  "release.stage.stopped": "Stopped offering an app version",
};

function describe(action: string): string {
  if (ACTION_TEXT[action]) return ACTION_TEXT[action];
  if (action.startsWith("screen.command.")) return `Sent "${action.slice(15)}" to a screen`;
  return action;
}

const WARN = new Set(["auth.login_failed", "auth.2fa_failed", "user.reset_2fa", "auth.password_change_failed", "screen.claim_failed", "user.deactivate"]);

const PERIODS = [
  { value: 0, label: "Today" },
  { value: 6, label: "Last 7 days" },
  { value: 29, label: "Last 30 days" },
  { value: 89, label: "Last 90 days" },
  { value: 364, label: "Last year" },
];

const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const noSubscribe = () => () => undefined;
const todayInIndia = () => IST_DAY.format(new Date());

function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** "Today" depends on the viewer's clock, so wait for the browser. */
export function ActivityView() {
  const today = useSyncExternalStore(noSubscribe, todayInIndia, () => null);
  return today ? <Activity today={today} /> : <div className="h-96 animate-pulse rounded-xl bg-muted" />;
}

function Activity({ today }: { today: string }) {
  const [days, setDays] = useState(6);
  const [userId, setUserId] = useState("");
  const [area, setArea] = useState("");
  const [data, setData] = useState<{ key: string; res: ActivityResponse } | null>(null);
  const [more, setMore] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ from: shift(today, days), to: today });
  if (userId) params.set("userId", userId);
  if (area) params.set("area", area);
  const query = params.toString();

  useEffect(() => {
    let live = true;
    apiFetch<ActivityResponse>(`/api/activity?${query}`)
      .then((res) => {
        if (!live) return;
        setData({ key: query, res });
        setMore([]);
        setNext(res.next);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [query]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<ActivityResponse>(`/api/activity?${query}&before=${encodeURIComponent(next)}`);
      setMore((m) => [...m, ...res.entries]);
      setNext(res.next);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoadingMore(false);
  }

  const loading = data?.key !== query;
  const entries = data ? [...data.res.entries, ...more] : [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 sm:px-5">
        <div className="grid min-w-40 gap-1.5">
          <Label htmlFor="a-period">When</Label>
          <NativeSelect id="a-period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-44 gap-1.5">
          <Label htmlFor="a-user">Person</Label>
          <NativeSelect id="a-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {data?.res.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-40 gap-1.5">
          <Label htmlFor="a-area">Area</Label>
          <NativeSelect id="a-area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {data?.res.areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </div>
        <a href={`/api/activity/export?${query}`} className={cn(buttonVariants({ variant: "outline" }), "ml-auto h-10 px-4")}>
          <Download data-icon="inline-start" />
          Download CSV
        </a>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className={cn("overflow-hidden rounded-xl border bg-card transition-opacity", loading && data && "opacity-60")}>
        {!data ? (
          <div className="h-72 animate-pulse bg-muted" />
        ) : entries.length === 0 ? (
          <p className="px-4 py-6 text-[15px] text-muted-foreground sm:px-5">Nothing was recorded in this period.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <Row key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </section>

      {next && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="h-10 px-4">
            {loadingMore && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Show older
          </Button>
        </div>
      )}
    </div>
  );
}

function who(e: ActivityEntry): string {
  if (e.user) return e.user.name;
  const email = (e.details as { email?: unknown } | null)?.email;
  if (e.action === "auth.login_failed" && typeof email === "string") return `Unknown (${email})`;
  return e.action.startsWith("screen.") ? "A TV" : "System";
}

function DetailList({ details }: { details: unknown }) {
  if (details === null || typeof details !== "object") return null;
  const pairs = Object.entries(details as Record<string, unknown>);
  if (!pairs.length) return null;
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
      {pairs.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ entry: e }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const hasMore = e.details !== null || e.ipAddress || e.entityId;
  return (
    <li className="px-4 py-2.5 sm:px-5">
      <button
        type="button"
        onClick={() => hasMore && setOpen(!open)}
        aria-expanded={hasMore ? open : undefined}
        className={cn("flex w-full flex-wrap items-baseline gap-x-4 gap-y-0.5 text-left", hasMore && "cursor-pointer")}
      >
        <span className="w-28 shrink-0 text-sm text-muted-foreground tabular-nums">{WHEN.format(new Date(e.at))}</span>
        <span className="min-w-36 font-medium">{who(e)}</span>
        <span className={cn("min-w-0 flex-1", WARN.has(e.action) && "text-[#8a5a00]")}>{describe(e.action)}</span>
        {hasMore && <ChevronDown className={cn("size-4 shrink-0 self-center text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 rounded-lg bg-mist/60 px-3 py-2.5 sm:ml-32">
          <DetailList details={e.details} />
          <p className="text-xs text-muted-foreground">
            {e.entityType}
            {e.entityId && ` ${e.entityId}`}
            {e.ipAddress && `, from ${e.ipAddress}`}
            {`, code ${e.action}`}
          </p>
        </div>
      )}
    </li>
  );
}
