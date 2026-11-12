"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  MAX_ALERT_RECIPIENTS,
  OFFLINE_AFTER_CHOICES,
  type AlertEntry,
  type AlertSettingsValue,
  type AlertsResponse,
} from "@darpan/shared";
import { CheckCircle2, Loader2, Mail, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { HoursEditor, type HoursLabels } from "../schedules/hours-editor";
import { describeHours } from "../schedules/format";

const REFRESH_MS = 60_000;

const WINDOW_LABELS: HoursLabels = {
  days: "Days to watch",
  on: "From",
  off: "Until",
  saturdays: "Saturdays to skip",
  saturdayHint: "No alerts on these Saturdays, when branches are closed.",
};

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

function when(iso: string, now: number): string {
  const d = new Date(iso);
  return IST_DAY.format(d) === IST_DAY.format(new Date(now)) ? IST_TIME.format(d) : IST.format(d);
}

function span(fromIso: string, to: number): string {
  const m = Math.max(1, Math.round((to - new Date(fromIso).getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function AlertsView() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const accept = useCallback((d: AlertsResponse) => {
    setData(d);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const load = () =>
      apiFetch<AlertsResponse>("/api/alerts")
        .then(accept)
        .catch((e: Error) => setError(e.message));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [accept]);

  if (!data) {
    return error ? <p className="text-destructive">{error}</p> : <div className="h-96 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-6">
        <OfflineNow alerts={data.open} now={now} settings={data.settings} />
        <BackOnline alerts={data.recent} now={now} />
      </div>
      <SettingsCard key={JSON.stringify(data.settings)} data={data} onSaved={accept} />
    </div>
  );
}

function OfflineNow({ alerts, now, settings }: { alerts: AlertEntry[]; now: number; settings: AlertSettingsValue }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Offline now</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{alerts.length}</span>
      </div>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6 sm:px-5">
          <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden />
          <p className="text-[15px]">Every screen has checked in within the last {settings.offlineAfterMin} minutes.</p>
        </div>
      ) : (
        <ul className="divide-y">
          {alerts.map((a) => (
            <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-4 py-3 sm:px-5">
              <WifiOff className="mt-1 size-4 text-destructive" aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/screens/${a.screen.id}`} className="font-medium hover:text-neel hover:underline">
                    {a.screen.name}
                  </Link>
                  {a.branch && <span className="text-sm text-muted-foreground">{a.branch}</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  Last heard {when(a.offlineSince, now)}, {span(a.offlineSince, now)} ago.{" "}
                  {a.notifiedAt ? `Emailed ${when(a.notifiedAt, now)}.` : "No email yet: it is outside the hours this screen should be on."}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BackOnline({ alerts, now }: { alerts: AlertEntry[]; now: number }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Back online</h2>
        <p className="text-sm text-muted-foreground">Screens that were offline in the last 7 days.</p>
      </div>
      {alerts.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-muted-foreground sm:px-5">No screen has been offline in the last 7 days.</p>
      ) : (
        <ul className="divide-y">
          {alerts.map((a) => (
            <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5 text-sm sm:px-5">
              <span className="min-w-0 truncate">
                <Link href={`/screens/${a.screen.id}`} className="font-medium hover:text-neel hover:underline">
                  {a.screen.name}
                </Link>
                {a.branch && <span className="text-muted-foreground"> {a.branch}</span>}
              </span>
              <span className="text-muted-foreground tabular-nums">{a.resolvedAt && when(a.resolvedAt, now)}</span>
              <span className="col-span-2 text-xs text-muted-foreground">
                Offline {span(a.offlineSince, a.resolvedAt ? new Date(a.resolvedAt).getTime() : now)}
                {a.notifiedAt ? "" : ", outside its hours, so no email"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SettingsCard({ data, onSaved }: { data: AlertsResponse; onSaved: (d: AlertsResponse) => void }) {
  const [value, setValue] = useState<AlertSettingsValue>(data.settings);
  const [emails, setEmails] = useState(data.settings.recipients.join("\n"));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const recipients = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const next: AlertSettingsValue = { ...value, recipients };
  const dirty = JSON.stringify(next) !== JSON.stringify(data.settings);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      onSaved(await apiFetch<AlertsResponse>("/api/alerts/settings", { method: "PUT", body: JSON.stringify(next) }));
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const r = await apiFetch<{ sentTo: string[] }>("/api/alerts/test", { method: "POST" });
      setMessage({
        ok: true,
        text: data.mailDriver === "console" ? `Test written to the server log for ${r.sentTo.join(", ")}.` : `Test email sent to ${r.sentTo.join(", ")}.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Email alerts</h2>
        <p className="text-sm text-muted-foreground">One email lists every screen that went offline or came back.</p>
      </div>
      <div className="grid gap-5 p-4 sm:p-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
            className="mt-0.5 size-4 accent-neel"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Send alert emails</span>
            <span className="text-sm text-muted-foreground">Offline screens are listed on this page either way.</span>
          </span>
        </label>

        <div className="grid gap-2">
          <Label htmlFor="alert-after">Count a screen offline after</Label>
          <NativeSelect id="alert-after" value={String(value.offlineAfterMin)} onChange={(e) => setValue({ ...value, offlineAfterMin: Number(e.target.value) })}>
            {OFFLINE_AFTER_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? "1 hour" : `${m} minutes`} without a check-in
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="alert-emails">Email to</Label>
          <textarea
            id="alert-emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={3}
            placeholder={"it.head@example.com\nho.admin@example.com"}
            spellCheck={false}
            className="min-h-20 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-sm text-muted-foreground">
            One address per line, up to {MAX_ALERT_RECIPIENTS}.
            {recipients.length > 0 && ` ${recipients.length} address${recipients.length === 1 ? "" : "es"}.`}
          </p>
        </div>

        <div className="grid gap-3 rounded-lg bg-mist/50 p-3">
          <div>
            <p className="text-sm font-medium">When to watch</p>
            <p className="text-sm text-muted-foreground">
              Screens with display hours are watched only while they should be on. Others are watched {describeHours(value.window)}.
            </p>
          </div>
          <HoursEditor value={value.window} onChange={(window) => setValue({ ...value, window })} idPrefix="alert-window" labels={WINDOW_LABELS} />
        </div>

        {data.mailDriver === "console" && (
          <p className="rounded-md border border-haldi/40 bg-[#fdf6e7] px-3 py-2 text-sm text-[#6b4600]">
            Emails are written to the server log for now. Real sending starts when the system is set up on the live server.
          </p>
        )}

        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={
              message.ok
                ? "rounded-md bg-ok/10 px-3 py-2 text-sm text-[#1b5e33]"
                : "rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive"
            }
          >
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={test}
            disabled={testing || dirty || data.settings.recipients.length === 0}
            title={dirty ? "Save first" : undefined}
            className="h-10 px-3"
          >
            {testing ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Mail data-icon="inline-start" />}
            Send test email
          </Button>
          <Button onClick={save} disabled={!dirty || saving || value.window.days.length === 0} className="h-10 px-4">
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}
