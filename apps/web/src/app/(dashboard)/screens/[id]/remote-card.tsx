"use client";

import { useCallback, useEffect, useState } from "react";
import type { RemoteCommandType, ScreenCommandEntry, ScreenDetail } from "@darpan/shared";
import { Camera, Eraser, Loader2, Power, RefreshCw } from "lucide-react";
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
import { apiFetch } from "@/lib/api-client";
import { formatAgo } from "@/lib/format";

const LABEL: Record<string, string> = {
  reload: "Reload content",
  restart: "Restart app",
  clearCache: "Clear downloaded files",
  screenshot: "Screenshot",
};

const ACTIONS: { type: RemoteCommandType; icon: typeof RefreshCw; text: string; hint: string }[] = [
  { type: "screenshot", icon: Camera, text: "Take screenshot", hint: "See what the TV shows right now" },
  { type: "reload", icon: RefreshCw, text: "Reload content", hint: "Fetch the playlist again" },
  { type: "restart", icon: Power, text: "Restart app", hint: "Close and reopen the app" },
  { type: "clearCache", icon: Eraser, text: "Clear files", hint: "Delete saved files and download them again" },
];

const waiting = (c: ScreenCommandEntry) => c.status === "PENDING" || c.status === "SENT";

function statusText(c: ScreenCommandEntry): { text: string; tone: string } {
  if (waiting(c)) return { text: "Waiting for the TV", tone: "text-muted-foreground" };
  if (c.status === "ACKED") return { text: "Done", tone: "text-[#1b7f3b]" };
  return { text: c.error ?? "Failed", tone: "text-destructive" };
}

/** Screenshot, reload, restart and clear files for one TV, with the last few results. */
export function RemoteCard({ screen }: { screen: ScreenDetail }) {
  const [list, setList] = useState<ScreenCommandEntry[] | null>(null);
  const [sending, setSending] = useState<RemoteCommandType | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const accept = useCallback((rows: ScreenCommandEntry[]) => {
    setList(rows);
    setNow(Date.now());
  }, []);

  const busy = list?.some(waiting) ?? false;

  // Poll quickly while a command is on its way, slowly otherwise.
  useEffect(() => {
    const load = () =>
      apiFetch<ScreenCommandEntry[]>(`/api/screens/${screen.id}/commands`)
        .then(accept)
        .catch((e: Error) => setError(e.message));
    void load();
    const t = setInterval(load, busy ? 2_000 : 30_000);
    return () => clearInterval(t);
  }, [screen.id, busy, accept]);

  async function send(type: RemoteCommandType) {
    setSending(type);
    setError(null);
    try {
      accept(await apiFetch<ScreenCommandEntry[]>(`/api/screens/${screen.id}/commands`, { method: "POST", body: JSON.stringify({ type }) }));
    } catch (e) {
      setError((e as Error).message);
    }
    setSending(null);
  }

  const shot = list?.find((c) => c.screenshotUrl);
  const shotPending = list?.some((c) => c.type === "screenshot" && waiting(c)) ?? false;
  const offline = !screen.online || !screen.paired;

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Remote control</h2>
        <p className="text-sm text-muted-foreground">{offline ? "Works when the TV is connected." : "Reaches the TV in a few seconds."}</p>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        <figure className="grid gap-1.5">
          <div className="relative aspect-video overflow-hidden rounded-lg border bg-mist/60">
            {shot?.screenshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our API with the session cookie
              <img src={shot.screenshotUrl} alt={`What ${screen.name} showed`} className="size-full object-contain" />
            ) : (
              <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
                {shotPending ? "Taking a screenshot…" : "No screenshot yet"}
              </p>
            )}
            {shotPending && shot && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-card/90 px-2 py-1 text-xs">
                <Loader2 className="size-3 animate-spin" /> Updating
              </span>
            )}
          </div>
          {shot?.completedAt && <figcaption className="text-xs text-muted-foreground">Taken {formatAgo(shot.completedAt, now)}</figcaption>}
        </figure>

        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map(({ type, icon: Icon, text, hint }) => {
            const inFlight = sending === type || (list?.some((c) => c.type === type && waiting(c)) ?? false);
            return (
              <Button
                key={type}
                variant="outline"
                aria-description={hint}
                disabled={offline || sending !== null || inFlight}
                onClick={() => (type === "clearCache" ? setConfirmClear(true) : void send(type))}
                className={`h-10 justify-start px-3 ${type === "clearCache" ? "text-destructive hover:text-destructive" : ""}`}
              >
                {inFlight ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
                {text}
              </Button>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {list && list.length > 0 && (
          <ul className="grid gap-2 border-t pt-3 text-sm" aria-label="Recent commands">
            {list.slice(0, 5).map((c) => {
              const s = statusText(c);
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                  <span className="truncate">{LABEL[c.type] ?? c.type}</span>
                  <span className="text-muted-foreground tabular-nums">{formatAgo(c.createdAt, now)}</span>
                  <span className={`col-span-2 truncate text-xs ${s.tone}`} title={s.text}>
                    {s.text}
                    {c.issuedBy && <span className="text-muted-foreground">, by {c.issuedBy}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear downloaded files on “{screen.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The TV deletes every poster and video it has saved and downloads them again. Until the downloads finish it may show
              nothing. Use this when a file looks broken on screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep files</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmClear(false);
                void send("clearCache");
              }}
            >
              Clear and download again
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
