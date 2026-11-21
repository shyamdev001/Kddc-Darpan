"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KIOSK_MAINTENANCE_MIN,
  commandUnsupported,
  type KioskReleaseAction,
  type KioskState,
  type RemoteCommandType,
  type ScreenCommandEntry,
  type ScreenDetail,
} from "@darpan/shared";
import { Camera, DoorOpen, Eraser, Loader2, Lock, LockOpen, MoonStar, Power, RefreshCw, RotateCcw, Volume2, VolumeX } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionUser } from "@/components/session-context";
import { apiFetch } from "@/lib/api-client";
import { formatAgo } from "@/lib/format";

const LABEL: Record<string, string> = {
  reload: "Reload content",
  restart: "Restart app",
  clearCache: "Clear downloaded files",
  screenshot: "Screenshot",
  kioskUnlock: "Unlock for maintenance",
  kioskLock: "Lock",
  screenOffTest: "Test screen off",
  reboot: "Restart TV",
  mute: "Mute",
  unmute: "Unmute",
  volume: "Set volume",
  kioskExit: "Take out of kiosk mode",
  kioskRemoveOwner: "Remove device owner",
};

const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/**
 * Kiosk state to show. The screen record follows the TV's heartbeat (refreshed every half minute),
 * so a lock or unlock the TV confirmed in the last two minutes wins until the record catches up.
 */
function kioskNow(screen: ScreenDetail, list: ScreenCommandEntry[] | null, now: number): { state: KioskState | null; until: string | null } {
  const recent = list?.find((c) => (c.type === "kioskUnlock" || c.type === "kioskLock") && c.status === "ACKED");
  const doneAt = recent?.completedAt ? new Date(recent.completedAt).getTime() : 0;
  if (recent && screen.kiosk !== "off" && now - doneAt < 2 * 60_000) {
    return recent.type === "kioskUnlock"
      ? { state: "maintenance", until: new Date(doneAt + KIOSK_MAINTENANCE_MIN * 60_000).toISOString() }
      : { state: "locked", until: null };
  }
  return { state: screen.kiosk, until: screen.kioskUntil };
}

const ACTIONS: { type: RemoteCommandType; icon: typeof RefreshCw; text: string; hint: string }[] = [
  { type: "screenshot", icon: Camera, text: "Take screenshot", hint: "See what the TV shows right now" },
  { type: "reload", icon: RefreshCw, text: "Reload content", hint: "Fetch the playlist again" },
  { type: "restart", icon: Power, text: "Restart app", hint: "Close and reopen the app" },
  { type: "reboot", icon: RotateCcw, text: "Restart TV", hint: "Restart the whole TV; back in about two minutes" },
  { type: "clearCache", icon: Eraser, text: "Clear files", hint: "Delete saved files and download them again" },
  {
    type: "screenOffTest",
    icon: MoonStar,
    text: "Test screen off",
    hint: "Panel off, then a minute later the TV must switch itself back on: can it sleep at night?",
  },
];

/** These ask first: they interrupt what the branch sees. */
const CONFIRM: Partial<Record<RemoteCommandType, { title: string; body: string; yes: string; no: string; danger?: boolean }>> = {
  clearCache: {
    title: "Clear downloaded files",
    body: "The TV deletes every poster and video it has saved and downloads them again. Until the downloads finish it may show nothing. Use this when a file looks broken on screen.",
    yes: "Clear and download again",
    no: "Keep files",
    danger: true,
  },
  reboot: {
    title: "Restart the TV",
    body: "The whole TV restarts. The screen is dark for one to three minutes, then Darpan starts by itself. Use this when the TV is slow or stuck, after a restart of the app did not help.",
    yes: "Restart TV",
    no: "Cancel",
  },
  screenOffTest: {
    title: "Test screen off",
    body: "The panel switches off and the TV is left to sleep; a minute later it must switch itself back on. On some models it stays dark until someone presses power, so run this when someone at the branch can do that. The answer can take up to eight minutes.",
    yes: "Run the test",
    no: "Cancel",
  },
};

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
  const [confirm, setConfirm] = useState<RemoteCommandType | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const me = useSessionUser();
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

  async function send(type: RemoteCommandType, level?: number) {
    setSending(type);
    setError(null);
    try {
      accept(await apiFetch<ScreenCommandEntry[]>(`/api/screens/${screen.id}/commands`, { method: "POST", body: JSON.stringify({ type, level }) }));
    } catch (e) {
      setError((e as Error).message);
    }
    setSending(null);
  }

  const shot = list?.find((c) => c.screenshotUrl);
  const shotPending = list?.some((c) => c.type === "screenshot" && waiting(c)) ?? false;
  const offline = !screen.online || !screen.paired;
  const kiosk = kioskNow(screen, list, now);
  // Greyed out with the reason below: what this TV reported it cannot do (or an app too old to know).
  const notes = unsupportedNotes(screen);
  const kioskBusy = sending === "kioskUnlock" || sending === "kioskLock" || (list?.some((c) => (c.type === "kioskUnlock" || c.type === "kioskLock") && waiting(c)) ?? false);

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
            {shot?.screenshotUrl && screen.capabilities?.videoInScreenshot === false && (
              <span className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[11px] text-white">
                This TV cannot capture video: a black area here can be a video playing normally.
              </span>
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
            const why = commandUnsupported(type, screen.capabilities);
            return (
              <Button
                key={type}
                variant="outline"
                aria-description={why ?? hint}
                title={why ?? undefined}
                disabled={offline || sending !== null || inFlight || why !== null}
                onClick={() => (CONFIRM[type] ? setConfirm(type) : void send(type))}
                className={`h-10 justify-start px-3 ${type === "clearCache" ? "text-destructive hover:text-destructive" : ""}`}
              >
                {inFlight ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
                {text}
              </Button>
            );
          })}
        </div>

        <SoundRow
          screen={screen}
          disabled={offline || sending !== null}
          busy={list?.some((c) => (c.type === "mute" || c.type === "unmute" || c.type === "volume") && waiting(c)) ?? false}
          onSend={(type, level) => void send(type, level)}
        />

        {notes.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="Not available on this TV">
            {notes.map(([label, why]) => (
              <li key={label}>
                <span className="font-medium text-foreground">{label}:</span> {why}
              </li>
            ))}
          </ul>
        )}

        <KioskRow state={kiosk.state} until={kiosk.until} busy={kioskBusy} disabled={offline || sending !== null} onSend={(t) => void send(t)} />

        {me?.role === "SUPER_ADMIN" && (kiosk.state === "locked" || kiosk.state === "maintenance" || kiosk.state === "exited") && (
          <Button variant="outline" disabled={offline} onClick={() => setReleaseOpen(true)} className="h-10 justify-start px-3 text-destructive hover:text-destructive">
            <DoorOpen data-icon="inline-start" />
            Take out of kiosk mode…
          </Button>
        )}

        {screen.adbEnabled && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            <span className="font-medium">Android debugging (adb) is on.</span> Anyone on the branch network could control this TV
            and read its key.{" "}
            {kiosk.state === "maintenance"
              ? "It is allowed during maintenance; locking the TV turns it off again."
              : kiosk.state === "locked"
                ? "Install the latest app: it turns debugging off while the TV is locked."
                : "Turn it off in the TV's Developer options, or set up kiosk mode, which turns it off by itself."}
          </p>
        )}

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

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && CONFIRM[confirm] && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {CONFIRM[confirm]!.title} on “{screen.name}”?
              </AlertDialogTitle>
              <AlertDialogDescription>{CONFIRM[confirm]!.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{CONFIRM[confirm]!.no}</AlertDialogCancel>
              <Button
                variant={CONFIRM[confirm]!.danger ? "destructive" : "default"}
                onClick={() => {
                  const type = confirm;
                  setConfirm(null);
                  void send(type);
                }}
              >
                {CONFIRM[confirm]!.yes}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      {releaseOpen && (
        <ReleaseDialog
          screen={screen}
          exited={kiosk.state === "exited"}
          onClose={() => setReleaseOpen(false)}
          onSent={(rows) => {
            accept(rows);
            setReleaseOpen(false);
          }}
        />
      )}
    </section>
  );
}

/** The commands this TV reported it cannot take, with the reason, for the note under the buttons. */
function unsupportedNotes(screen: ScreenDetail): [string, string][] {
  const out: [string, string][] = [];
  for (const [type, label] of [
    ["reboot", "Restart TV"],
    ["volume", "Volume and mute"],
    ["screenOffTest", "Test screen off"],
  ] as const) {
    const why = commandUnsupported(type, screen.capabilities);
    if (why) out.push([label, why]);
  }
  return out;
}

const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Mute, unmute and a volume level, when this TV lets Android set its volume. */
function SoundRow({
  screen,
  disabled,
  busy,
  onSend,
}: {
  screen: ScreenDetail;
  disabled: boolean;
  busy: boolean;
  onSend: (type: RemoteCommandType, level?: number) => void;
}) {
  const status = screen.tvStatus;
  const [level, setLevel] = useState<number>(status?.volume ?? 50);
  if (commandUnsupported("volume", screen.capabilities)) return null; // listed in the note instead
  const muted = status?.muted === true;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-mist/60 px-3 py-2">
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => onSend(muted ? "unmute" : "mute")}
        className="h-10 px-3"
        aria-description={muted ? "Turn the TV's sound back on" : "Silence the TV"}
      >
        {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : muted ? <Volume2 data-icon="inline-start" /> : <VolumeX data-icon="inline-start" />}
        {muted ? "Unmute" : "Mute"}
      </Button>
      <label className="grid gap-1 text-xs text-muted-foreground">
        <span>
          Volume {level}%
          {status?.volume !== null && status?.volume !== undefined && status.volume !== level ? ` (now ${status.volume}%)` : ""}
        </span>
        <select
          className="h-8 rounded-md border bg-card px-2 text-sm text-foreground"
          value={level}
          disabled={disabled || busy}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {STEPS.map((s) => (
            <option key={s} value={s}>
              {s}%
            </option>
          ))}
        </select>
      </label>
      <Button variant="outline" disabled={disabled || busy || level === status?.volume} onClick={() => onSend("volume", level)} className="h-10 px-3">
        Set
      </Button>
    </div>
  );
}

/**
 * K7: takes this TV out of kiosk mode (it then behaves like a normal TV until it is locked again
 * from here), or also removes Darpan as device owner, before the TV is handed back or given to
 * another app. Super admins only, with a fresh two-step code, the screen's name typed to be sure it
 * is the right TV, and a reason for the activity log.
 */
function ReleaseDialog({
  screen,
  exited,
  onClose,
  onSent,
}: {
  screen: ScreenDetail;
  exited: boolean;
  onClose: () => void;
  onSent: (rows: ScreenCommandEntry[]) => void;
}) {
  const [action, setAction] = useState<KioskReleaseAction>(exited ? "removeOwner" : "exit");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = name.trim().normalize("NFC").toLowerCase() === (screen.name ?? "").trim().normalize("NFC").toLowerCase();
  const ok = nameOk && /^\S{6,40}$/.test(code) && reason.trim().length >= 5;

  async function submit() {
    setSending(true);
    setError(null);
    try {
      onSent(
        await apiFetch<ScreenCommandEntry[]>(`/api/screens/${screen.id}/kiosk-release`, {
          method: "POST",
          body: JSON.stringify({ action, code, confirmName: name, reason }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !sending) void submit();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Take “{screen.name}” out of kiosk mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the remote can then leave Darpan and change the TV&apos;s settings. This is for a TV that is being
              handed back, repaired elsewhere or given to another app. To open the settings for a while, use the unlock
              button instead.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1 font-medium">What to do</legend>
            {!exited && (
              <label className="flex items-start gap-2">
                <input type="radio" name="release" className="mt-1" checked={action === "exit"} onChange={() => setAction("exit")} />
                <span>
                  <span className="font-medium">Leave kiosk mode.</span>{" "}
                  <span className="text-muted-foreground">Darpan keeps playing and stays device owner; it can be locked again from here.</span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2">
              <input type="radio" name="release" className="mt-1" checked={action === "removeOwner"} onChange={() => setAction("removeOwner")} />
              <span>
                <span className="font-medium">Also remove Darpan as device owner.</span>{" "}
                <span className="text-muted-foreground">
                  Cannot be undone from here: locking this TV again needs a factory reset and setup with a cable. The app can
                  then be uninstalled.
                </span>
              </span>
            </label>
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor="release-name">Type the screen&apos;s name: {screen.name}</Label>
            <Input id="release-name" autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="release-reason">Why (kept in the activity log)</Label>
            <Input id="release-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="release-code">Code from your two-step app</Label>
            <Input id="release-code" inputMode="numeric" autoComplete="one-time-code" maxLength={40} value={code} onChange={(e) => setCode(e.target.value.trim())} />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Keep it locked</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!ok || sending}>
              {sending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {action === "exit" ? "Take out of kiosk mode" : "Remove device owner"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function KioskRow({
  state,
  until,
  busy,
  disabled,
  onSend,
}: {
  state: KioskState | null;
  until: string | null;
  busy: boolean;
  disabled: boolean;
  onSend: (type: RemoteCommandType) => void;
}) {
  if (state === null) return null; // app version from before kiosk mode
  if (state === "exited") {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-destructive/[0.06] px-3 py-2">
        <p className="text-sm text-destructive">
          <span className="font-medium">Taken out of kiosk mode.</span> The remote can leave the app. Darpan is still device owner.
        </p>
        <Button variant="outline" disabled={disabled || busy} onClick={() => onSend("kioskLock")} className="h-10 px-3">
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Lock data-icon="inline-start" />}
          Lock again
        </Button>
      </div>
    );
  }
  if (state === "off") {
    return (
      <p className="rounded-md bg-mist/60 px-3 py-2 text-sm text-muted-foreground">
        Kiosk mode is not set up on this TV, so the remote can leave the app. It is set up once with a cable or network
        connection; see the TV app guide.
      </p>
    );
  }
  const locked = state === "locked";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-mist/60 px-3 py-2">
      <p className="text-sm">
        {locked ? (
          <>
            <span className="font-medium">Locked.</span> <span className="text-muted-foreground">Only Darpan can run on this TV.</span>
          </>
        ) : (
          <>
            <span className="font-medium">Unlocked for maintenance</span>
            <span className="text-muted-foreground">
              {until ? ` until ${TIME.format(new Date(until))}` : ""}. The TV&apos;s settings can be opened with the Menu key.
            </span>
          </>
        )}
      </p>
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => onSend(locked ? "kioskUnlock" : "kioskLock")}
        aria-description={locked ? `Allow the TV's settings for ${KIOSK_MAINTENANCE_MIN} minutes, then lock again` : "Lock the TV now"}
        className="h-10 px-3"
      >
        {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : locked ? <LockOpen data-icon="inline-start" /> : <Lock data-icon="inline-start" />}
        {locked ? `Unlock for ${KIOSK_MAINTENANCE_MIN} min` : "Lock now"}
      </Button>
    </div>
  );
}
