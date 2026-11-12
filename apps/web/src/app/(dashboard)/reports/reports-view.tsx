"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { BranchOption, PlayReport } from "@darpan/shared";
import { Download, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Choose dates" },
];

const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }); // yyyy-mm-dd
const NUM = new Intl.NumberFormat("en-IN");
const SHORT_DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Calendar maths on yyyy-mm-dd strings, in UTC so no time zone can shift a day. */
function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function range(p: Period, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  switch (p) {
    case "yesterday":
      return [shift(today, -1), shift(today, -1)];
    case "7d":
      return [shift(today, -6), today];
    case "30d":
      return [shift(today, -29), today];
    case "month":
      return [first(y, m), today];
    case "lastMonth":
      return [first(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), shift(first(y, m), -1)];
    default:
      return [today, today];
  }
}

function hours(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${NUM.format(h)} h ${min % 60} min` : `${NUM.format(h)} h`;
}

type Pick = { id: string; name: string } | null;

const noSubscribe = () => () => {};
const todayInIndia = () => IST_DAY.format(new Date());

/** "Today" depends on the viewer's clock, so the page waits for the browser before asking for a report. */
export function ReportsView() {
  const today = useSyncExternalStore(noSubscribe, todayInIndia, () => null);
  return today ? <Report today={today} /> : <div className="h-96 animate-pulse rounded-xl bg-muted" />;
}

function Report({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>("7d");
  const [custom, setCustom] = useState<[string, string]>(() => range("7d", today));
  const [branchId, setBranchId] = useState("");
  const [screen, setScreen] = useState<Pick>(null);
  const [ad, setAd] = useState<Pick>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [report, setReport] = useState<PlayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The query the shown report answers; differs from `query` while a new one loads. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const [from, to] = period === "custom" ? custom : range(period, today);
  const badRange = !from || !to || to < from;
  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to });
    if (branchId) q.set("branchId", branchId);
    if (screen) q.set("screenId", screen.id);
    if (ad) q.set("mediaId", ad.id);
    return q.toString();
  }, [from, to, branchId, screen, ad]);
  const loading = loadedFor !== query;

  useEffect(() => {
    apiFetch<BranchOption[]>("/api/branches")
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    if (badRange) return;
    let live = true;
    apiFetch<PlayReport>(`/api/reports/plays?${query}`)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
        setLoadedFor(query);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        setLoadedFor(query);
      });
    return () => {
      live = false;
    };
  }, [query, badRange]);

  const canExport = !badRange && !loading && !!report?.totals.plays;

  return (
    <div className="grid gap-6">
      <section aria-label="Filters" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 sm:p-5">
        <div className="grid gap-2">
          <Label htmlFor="rep-period">Period</Label>
          <NativeSelect id="rep-period" value={period} onChange={(e) => {
              const next = e.target.value as Period;
              if (next === "custom" && period !== "custom") setCustom(range(period, today));
              setPeriod(next);
            }}
            className="w-44"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {period === "custom" && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="rep-from">From</Label>
              <Input id="rep-from" type="date" value={custom[0]} max={today} onChange={(e) => setCustom([e.target.value, custom[1]])} className="h-10 w-44 bg-card" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rep-to">To</Label>
              <Input id="rep-to" type="date" value={custom[1]} min={custom[0]} max={today} onChange={(e) => setCustom([custom[0], e.target.value])} className="h-10 w-44 bg-card" />
            </div>
          </>
        )}
        <div className="grid gap-2">
          <Label htmlFor="rep-branch">Branch</Label>
          <NativeSelect id="rep-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-56">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {screen && <Chip label={`Screen: ${screen.name}`} onClear={() => setScreen(null)} />}
        {ad && <Chip label={`Ad: ${ad.name}`} onClear={() => setAd(null)} />}
        <a
          href={canExport ? `/api/reports/plays/export?${query}` : undefined}
          aria-disabled={!canExport}
          className={cn(buttonVariants({ variant: "outline" }), "ml-auto h-10 px-3", !canExport && "pointer-events-none opacity-50")}
        >
          <Download data-icon="inline-start" />
          Download for Excel
        </a>
      </section>

      {badRange ? (
        <p className="text-destructive">Pick a start date on or before the end date.</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : !report ? (
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className={cn("grid gap-6 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <Summary report={report} />
          {report.totals.plays === 0 ? (
            <p className="rounded-xl border bg-card px-5 py-8 text-center text-muted-foreground">
              No plays recorded for this period. TVs send their records every hour, so the last hour may not be in yet.
            </p>
          ) : (
            <>
              {report.byDay.length > 0 && report.from !== report.to && <Days report={report} />}
              <div className="grid items-start gap-6 xl:grid-cols-2">
                <ByAd report={report} selected={ad} onPick={setAd} />
                <ByScreen report={report} selected={screen} onPick={setScreen} />
              </div>
              <p className="text-sm text-muted-foreground">TVs send their records every hour, so the last hour may not be in yet.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-10 max-w-72 items-center gap-1 rounded-lg bg-neel-soft pr-1 pl-3 text-sm text-neel">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label={`Remove filter ${label}`} className="grid size-8 place-items-center rounded-md hover:bg-neel/10">
        <X className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function Summary({ report }: { report: PlayReport }) {
  const { totals } = report;
  const items = [
    { label: totals.plays === 1 ? "play" : "plays", value: NUM.format(totals.plays) },
    { label: "on screen", value: hours(totals.durationMs) },
    { label: totals.screens === 1 ? "screen" : "screens", value: NUM.format(totals.screens) },
    { label: totals.ads === 1 ? "ad" : "ads", value: NUM.format(totals.ads) },
  ];
  return (
    <p className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-baseline gap-2">
          <span className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{i.value}</span>
          <span className="text-muted-foreground">{i.label}</span>
        </span>
      ))}
    </p>
  );
}

function Days({ report }: { report: PlayReport }) {
  // Every day in the range, including days with no plays, so gaps show as gaps.
  const counts = new Map(report.byDay.map((d) => [d.day, d.plays]));
  const days: { day: string; plays: number }[] = [];
  for (let d = report.from; d <= report.to && days.length < 400; d = shift(d, 1)) days.push({ day: d, plays: counts.get(d) ?? 0 });
  const max = Math.max(1, ...days.map((d) => d.plays));
  const label = (d: { day: string; plays: number }) => `${SHORT_DAY.format(new Date(`${d.day}T00:00:00Z`))}: ${NUM.format(d.plays)} plays`;
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="mb-3 font-heading text-lg font-semibold tracking-tight">Plays per day</h2>
      <ul className="flex h-28 items-end gap-px">
        {days.map((d) => (
          <li key={d.day} aria-label={label(d)} title={label(d)} className="flex h-full min-w-0 flex-1 items-end">
            <div className={cn("w-full rounded-t-sm", d.plays ? "bg-neel/80" : "bg-border")} style={{ height: d.plays ? `${Math.max(3, (d.plays / max) * 100)}%` : "2px" }} />
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{SHORT_DAY.format(new Date(`${report.from}T00:00:00Z`))}</span>
        <span>{SHORT_DAY.format(new Date(`${report.to}T00:00:00Z`))}</span>
      </div>
    </section>
  );
}

function Table({ title, hint, head, children }: { title: string; hint: string; head: string[]; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {head.map((h, i) => (
                <th key={h} scope="col" className={cn("px-4 py-2 font-medium sm:px-5", i > 0 && "w-0 text-right whitespace-nowrap")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">{children}</tbody>
        </table>
      </div>
    </section>
  );
}

const NUM_CELL = "px-4 py-2.5 text-right whitespace-nowrap tabular-nums sm:px-5";

function ByAd({ report, selected, onPick }: { report: PlayReport; selected: Pick; onPick: (p: Pick) => void }) {
  return (
    <Table title="By ad" hint={selected ? "Showing one ad." : "Pick an ad to see only its plays."} head={["Ad", "Screens", "Plays", "On screen"]}>
      {report.byMedia.map((m) => (
        <tr key={m.mediaId ?? `gone-${m.name}`}>
          <td className="max-w-0 px-4 py-2.5 sm:px-5">
            {m.mediaId && !selected ? (
              <button type="button" onClick={() => onPick({ id: m.mediaId!, name: m.name })} className="block max-w-full truncate text-left font-medium hover:text-neel hover:underline">
                {m.name}
              </button>
            ) : (
              <span className="block truncate font-medium">
                {m.name}
                {!m.mediaId && <span className="font-normal text-muted-foreground"> (deleted)</span>}
              </span>
            )}
          </td>
          <td className={NUM_CELL}>{m.screens}</td>
          <td className={NUM_CELL}>{NUM.format(m.plays)}</td>
          <td className={NUM_CELL}>{hours(m.durationMs)}</td>
        </tr>
      ))}
    </Table>
  );
}

function ByScreen({ report, selected, onPick }: { report: PlayReport; selected: Pick; onPick: (p: Pick) => void }) {
  return (
    <Table title="By screen" hint={selected ? "Showing one screen." : "Pick a screen to see only what it played."} head={["Screen", "Ads", "Plays", "On screen"]}>
      {report.byScreen.map((s) => (
        <tr key={s.screenId ?? `gone-${s.name}`}>
          <td className="max-w-0 px-4 py-2.5 sm:px-5">
            {s.screenId && !selected ? (
              <button type="button" onClick={() => onPick({ id: s.screenId!, name: s.name })} className="block max-w-full truncate text-left font-medium hover:text-neel hover:underline">
                {s.name}
              </button>
            ) : s.screenId ? (
              <Link href={`/screens/${s.screenId}`} className="block truncate font-medium hover:text-neel hover:underline">
                {s.name}
              </Link>
            ) : (
              <span className="block truncate font-medium">
                {s.name} <span className="font-normal text-muted-foreground">(removed)</span>
              </span>
            )}
            {s.branch && <span className="block truncate text-xs text-muted-foreground">{s.branch}</span>}
          </td>
          <td className={NUM_CELL}>{s.ads}</td>
          <td className={NUM_CELL}>{NUM.format(s.plays)}</td>
          <td className={NUM_CELL}>{hours(s.durationMs)}</td>
        </tr>
      ))}
    </Table>
  );
}
