"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AppReleaseEntry, ReleaseStage, ReleasesResponse, UpdateScreenEntry } from "@darpan/shared";
import { Loader2, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { formatBytes, formatDay } from "@/lib/format";
import { goToSignInExpired } from "@/lib/session-expired";
import { cn } from "@/lib/utils";

const STAGE: Record<ReleaseStage, { text: string; tone: string }> = {
  TEST: { text: "Test screens", tone: "bg-[#fdf6e7] text-[#6b4600]" },
  ALL: { text: "All screens", tone: "bg-ok/10 text-[#1b5e33]" },
  STOPPED: { text: "Stopped", tone: "bg-muted text-muted-foreground" },
};

type Confirm = { kind: "all" | "delete"; release: AppReleaseEntry } | null;

export function UpdatesView() {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      apiFetch<ReleasesResponse>("/api/releases")
        .then(setData)
        .catch((e: Error) => setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function act(id: string, run: () => Promise<ReleasesResponse>) {
    setWorking(id);
    setError(null);
    try {
      setData(await run());
    } catch (e) {
      setError((e as Error).message);
    }
    setWorking(null);
  }

  const setStage = (r: AppReleaseEntry, stage: ReleaseStage) =>
    act(r.id, () => apiFetch<ReleasesResponse>(`/api/releases/${r.id}`, { method: "PATCH", body: JSON.stringify({ stage }) }));

  if (!data) return error ? <p className="text-destructive">{error}</p> : <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  const kioskCount = data.screens.filter((s) => s.kiosk === "locked" || s.kiosk === "maintenance").length;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid gap-6">
        <UploadCard onDone={setData} />
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <section className="rounded-xl border bg-card">
          <div className="border-b px-4 py-3 sm:px-5">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Versions</h2>
            <p className="text-sm text-muted-foreground">
              Each TV installs the newest version offered to it. Only TVs in kiosk mode update by themselves ({kioskCount} of{" "}
              {data.screens.length}).
            </p>
          </div>
          {data.releases.length === 0 ? (
            <p className="px-4 py-6 text-[15px] text-muted-foreground sm:px-5">
              No versions uploaded yet. Upload the APK that GitHub built to start.
            </p>
          ) : (
            <ul className="divide-y">
              {data.releases.map((r) => (
                <li key={r.id} className="grid gap-2 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-heading text-lg font-semibold tabular-nums">{r.versionName}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">build {r.versionCode}</span>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", STAGE[r.stage].tone)}>{STAGE[r.stage].text}</span>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {r.screensOnIt} {r.screensOnIt === 1 ? "screen runs" : "screens run"} it
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatBytes(r.sizeBytes)}, uploaded {formatDay(r.createdAt)}
                    {r.uploadedBy && ` by ${r.uploadedBy}`}
                    {r.notes && <span className="block text-foreground">{r.notes}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {working === r.id && <Loader2 className="size-4 animate-spin self-center" aria-label="Saving" />}
                    {r.stage === "TEST" && (
                      <Button className="h-9 px-3" disabled={working !== null} onClick={() => setConfirm({ kind: "all", release: r })}>
                        Release to all screens
                      </Button>
                    )}
                    {r.stage === "STOPPED" && (
                      <Button variant="outline" className="h-9 px-3" disabled={working !== null} onClick={() => void setStage(r, "TEST")}>
                        Offer to test screens
                      </Button>
                    )}
                    {r.stage !== "STOPPED" && (
                      <Button variant="outline" className="h-9 px-3" disabled={working !== null} onClick={() => void setStage(r, "STOPPED")}>
                        Stop offering
                      </Button>
                    )}
                    {r.stage !== "ALL" && (
                      <Button
                        variant="ghost"
                        className="h-9 px-3 text-destructive hover:text-destructive"
                        disabled={working !== null}
                        onClick={() => setConfirm({ kind: "delete", release: r })}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <TestScreens key={data.screens.map((s) => `${s.id}:${s.testUpdates}`).join(",")} screens={data.screens} onSaved={setData} />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm.kind === "all"
                    ? `Release ${confirm.release.versionName} to all screens?`
                    : `Delete version ${confirm.release.versionName}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm.kind === "all"
                    ? "Every TV in kiosk mode downloads it within about 10 minutes and restarts into the new version. The screen goes dark for a few seconds while it installs. Check it on the test screens first."
                    : "The file is removed from the server. TVs that already installed it keep it."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant={confirm.kind === "delete" ? "destructive" : "default"}
                  onClick={() => {
                    const r = confirm.release;
                    const kind = confirm.kind;
                    setConfirm(null);
                    void (kind === "all"
                      ? setStage(r, "ALL")
                      : act(r.id, () => apiFetch<ReleasesResponse>(`/api/releases/${r.id}`, { method: "DELETE" })));
                  }}
                >
                  {confirm.kind === "all" ? "Release to all" : "Delete version"}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UploadCard({ onDone }: { onDone: (d: ReleasesResponse) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    if (notes.trim()) form.append("notes", notes.trim());
    try {
      const res = await fetch("/api/releases", { method: "POST", body: form });
      if (res.status === 401) {
        goToSignInExpired();
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const m = (body as { message?: string | string[] } | null)?.message;
        throw new Error(Array.isArray(m) ? m[0] : (m ?? `Upload failed (error ${res.status}).`));
      }
      const d = body as ReleasesResponse;
      onDone(d);
      setMessage({ ok: true, text: `Uploaded version ${d.releases[0]?.versionName ?? ""}. It is offered to the test screens only.` });
      setFile(null);
      setNotes("");
      if (input.current) input.current.value = "";
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Upload a new version</h2>
        <p className="text-sm text-muted-foreground">The kdcc-darpan.apk file from the GitHub build. Its version is read from the file.</p>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="grid gap-2">
          <Label htmlFor="apk-file">APK file</Label>
          <input
            ref={input}
            id="apk-file"
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:text-sm file:font-medium"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="apk-notes">What changed (optional)</Label>
          <textarea
            id="apk-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="min-h-16 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
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
        <div className="flex justify-end">
          <Button onClick={upload} disabled={!file || busy} className="h-10 px-4">
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            Upload
          </Button>
        </div>
      </div>
    </section>
  );
}

function TestScreens({ screens, onSaved }: { screens: UpdateScreenEntry[]; onSaved: (d: ReleasesResponse) => void }) {
  const initial = screens.filter((s) => s.testUpdates).map((s) => s.id);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = picked.size !== initial.length || initial.some((id) => !picked.has(id));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await apiFetch<ReleasesResponse>("/api/releases/test-screens", { method: "PUT", body: JSON.stringify({ screenIds: [...picked] }) }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Screens</h2>
        <p className="text-sm text-muted-foreground">Ticked screens are test screens: they get a new version before the others.</p>
      </div>
      {screens.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No paired screens yet.</p>
      ) : (
        <ul className="max-h-[32rem] divide-y overflow-y-auto">
          {screens.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
              <input
                id={`test-${s.id}`}
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-1 size-4 accent-neel"
              />
              <div className="grid min-w-0 gap-0.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <label htmlFor={`test-${s.id}`} className="font-medium">
                    {s.name}
                  </label>
                  {s.branch && <span className="text-muted-foreground">{s.branch}</span>}
                  <Link href={`/screens/${s.id}`} className="text-neel hover:underline">
                    Open
                  </Link>
                </div>
                <span className="text-muted-foreground">
                  {s.appVersion ? `Version ${s.appVersion}` : "Version unknown"}
                  {s.kiosk !== "locked" && s.kiosk !== "maintenance" && ", not in kiosk mode (update by hand)"}
                  {!s.online && ", offline"}
                </span>
                {s.updateStatus && (
                  <span className={cn(/failed|by hand|approval/i.test(s.updateStatus) ? "text-destructive" : "text-foreground")}>
                    {s.updateStatus}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mx-4 mb-3 text-sm text-destructive sm:mx-5">{error}</p>}
      <div className="flex justify-end border-t px-4 py-3 sm:px-5">
        <Button onClick={save} disabled={!dirty || saving} className="h-10 px-4">
          {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Save test screens
        </Button>
      </div>
    </section>
  );
}
