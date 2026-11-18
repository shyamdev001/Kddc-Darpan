"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FleetGroup, FleetSummary, FleetTally } from "@darpan/shared";
import { ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useScreenUpdates } from "@/lib/live-updates";

/** The oldest Android the TV app installs on (minSdk in apps/tv/app/build.gradle.kts). */
const APP_MIN_SDK = 23;

export function FleetView() {
  const [data, setData] = useState<FleetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiFetch<FleetSummary>("/api/screens/fleet")
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useScreenUpdates(load);

  if (error && !data) {
    return (
      <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
        Could not load the TV models: {error}
      </p>
    );
  }
  if (!data) return <div className="h-64 animate-pulse rounded-xl border bg-muted/40" aria-hidden />;
  if (data.screens === 0) {
    return <p className="rounded-xl border bg-card px-5 py-8 text-center text-muted-foreground">No screens in your area yet.</p>;
  }

  const older = data.screens - data.reported;
  return (
    <div className="grid gap-6">
      <p className="text-[15px]">
        {data.screens} {data.screens === 1 ? "screen" : "screens"}.{" "}
        {older === 0
          ? "Every one has sent its full report."
          : `${data.reported} sent the full report; ${older} ${older === 1 ? "runs" : "run"} an older app and ${older === 1 ? "shows" : "show"} less.`}
      </p>

      {data.attention.length > 0 && (
        <section className="rounded-xl border border-haldi/40 bg-haldi/10">
          <h2 className="px-5 pt-4 pb-2 font-semibold">Needs a look</h2>
          <ul className="divide-y divide-haldi/25">
            {data.attention.map((s) => (
              <li key={`${s.id}-${s.note}`}>
                <Link href={`/screens/${s.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-haldi/10">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.name}</span>
                    {s.branch && <span className="text-muted-foreground">, {s.branch}</span>}
                    <span className="block text-[#6b4a00]">{s.note}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border bg-card px-5 py-4">
        <h2 className="mb-3 font-semibold">What they can do</h2>
        <dl className="grid gap-3">
          <TallyRow label="Play our videos" t={data.videos} no="posters only" />
          <TallyRow label="Play portrait videos" t={data.portraitVideos} no="landscape only" />
          <TallyRow label="YouTube broadcasts" t={data.youtube} no="cannot" />
          <TallyRow label="Kiosk mode and auto-start" t={data.kiosk} no="not set up" />
          <TallyRow label="Brightness from the dashboard" t={data.brightness} no="ignored" />
          <TallyRow label="Screen off outside hours" t={data.screenOff} no="not possible" />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Not known: the TV has not said yet (older app, or never tried).</p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Groups
          title="Android versions"
          groups={data.android}
          note={
            data.lowestSdk === null
              ? "No screen has said which Android it runs yet."
              : `Oldest: API ${data.lowestSdk}. The app installs on API ${APP_MIN_SDK} or newer.` +
                (data.androidUnknown > 0 ? ` ${data.androidUnknown} not known yet.` : "")
          }
        />
        <Groups title="Models" groups={data.models} />
        <Groups title="Platform" groups={data.platforms} />
        <Groups title="App versions" groups={data.appVersions} />
      </div>
    </div>
  );
}

/** One ability as a split bar: works, does not, not known. */
function TallyRow({ label, t, no }: { label: string; t: FleetTally; no: string }) {
  const total = t.yes + t.no + t.unknown || 1;
  const words = [t.yes && `${t.yes} yes`, t.no && `${t.no} ${no}`, t.unknown && `${t.unknown} not known`].filter(Boolean).join(", ");
  return (
    <div className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="grid gap-1">
        <div className="flex h-2 overflow-hidden rounded-full bg-mist" aria-hidden>
          <span className="bg-neel" style={{ width: `${(t.yes / total) * 100}%` }} />
          <span className="bg-haldi" style={{ width: `${(t.no / total) * 100}%` }} />
        </div>
        <span className="text-sm">{words}</span>
      </dd>
    </div>
  );
}

function Groups({ title, groups, note }: { title: string; groups: FleetGroup[]; note?: string }) {
  return (
    <section className="rounded-xl border bg-card px-5 py-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {note && <p className="mb-2 text-sm text-muted-foreground">{note}</p>}
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>{title}</th>
            <th>Screens</th>
            <th>Online</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.label} className="border-t first:border-t-0">
              <td className="py-1.5 pr-3 break-words">{g.label}</td>
              <td className="py-1.5 text-right tabular-nums">{g.screens}</td>
              <td className="w-24 py-1.5 text-right text-muted-foreground tabular-nums">{g.online} online</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
