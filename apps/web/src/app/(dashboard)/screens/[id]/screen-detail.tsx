"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { filesProblem, youtubeSupport, type BranchOption, type Orientation, type PlaylistSummary, type ScreenDetail, type UpdateScreenRequest } from "@darpan/shared";
import { ChevronLeft, Loader2, Trash2 } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { useCanEdit } from "@/components/session-context";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatAgo, formatDay } from "@/lib/format";
import { useScreenUpdates } from "@/lib/live-updates";
import { OrientationPicker } from "../orientation-picker";
import { PairScreenButton } from "../pair-screen-dialog";
import { ScreenGlyph, ScreenStatusText } from "../screen-glyph";
import { SOURCE_TEXT } from "../screen-list";
import { describeHours, describeSlot } from "../../schedules/format";
import { RemoteCard } from "./remote-card";
import { ReplaceTv } from "./replace-tv";

export function ScreenDetailView() {
  const { id } = useParams<{ id: string }>();
  const canEdit = useCanEdit();
  const [screen, setScreen] = useState<ScreenDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // set with each fetch; Date.now() is not allowed during prerender

  const accept = useCallback((s: ScreenDetail) => {
    setScreen(s);
    setNow(Date.now());
  }, []);

  const load = useCallback(
    () =>
      apiFetch<ScreenDetail>(`/api/screens/${id}`)
        .then(accept)
        .catch((e: Error) => setLoadError(e.message)),
    [id, accept],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useScreenUpdates(load, { only: id });

  if (loadError && !screen) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">This screen could not be opened.</p>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        <Link href="/screens" className="mt-4 inline-block text-sm font-medium text-neel hover:underline">
          Back to screens
        </Link>
      </div>
    );
  }
  if (!screen) return <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  const ago = screen.lastSeenAt ? formatAgo(screen.lastSeenAt, now) : null;

  return (
    <div>
      <Link href="/screens" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Screens
      </Link>
      <header className="mt-2 mb-6">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{screen.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
          <ScreenStatusText screen={screen} ago={ago} />
          <span className="text-muted-foreground">{screen.branch?.name ?? "No branch"}</span>
        </p>
      </header>

      {!screen.paired && canEdit && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-haldi/40 bg-[#fdf6e7] px-4 py-3 sm:px-5">
          <p className="max-w-2xl text-[15px] text-[#6b4600]">
            This TV was reset and is showing a new pairing code. Pair it with that code to bring it back; enter the same
            name and branch.
          </p>
          <PairScreenButton label="Enter code" />
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          <PlaylistCard screen={screen} onSaved={accept} canEdit={canEdit} />
          {canEdit && (
            <SettingsCard key={screen.id + screen.name + screen.branch?.id + screen.orientation} screen={screen} onSaved={accept} />
          )}
        </div>
        <DeviceCard screen={screen} ago={ago} now={now} canEdit={canEdit} onReplaced={accept} />
      </div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

/** Playlist pages are head office only, so viewers get the name without a link. */
function PlaylistName({ id, name, link }: { id: string; name: string; link: boolean }) {
  return link ? (
    <Link href={`/playlists/${id}`} className="font-medium text-neel hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

function PlaylistCard({ screen, onSaved, canEdit }: { screen: ScreenDetail; onSaved: (s: ScreenDetail) => void; canEdit: boolean }) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [choice, setChoice] = useState(screen.ownPlaylistId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    apiFetch<PlaylistSummary[]>("/api/playlists")
      .then(setPlaylists)
      .catch((e: Error) => setError(e.message));
  }, [canEdit]);

  const dirty = choice !== (screen.ownPlaylistId ?? "");
  const inherited = screen.fallbackPlaylist;
  const chosen = playlists?.find((p) => p.id === choice);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const s = await apiFetch<ScreenDetail>(`/api/screens/${screen.id}/playlist`, {
        method: "PUT",
        body: JSON.stringify({ playlistId: choice || null }),
      });
      onSaved(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }

  return (
    <Card title="What it plays" description={canEdit ? "The TV picks up a change the next time it checks in." : undefined}>
      <div className="grid gap-4">
        {canEdit && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-56 flex-1 gap-2">
            <Label htmlFor="screen-playlist">Playlist</Label>
            <NativeSelect id="screen-playlist" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!playlists}>
              <option value="">{inherited ? `Follow ${SOURCE_TEXT[inherited.source].replace("from ", "")} (${inherited.name})` : "None"}</option>
              {playlists?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button onClick={save} disabled={!dirty || saving} className="h-10 min-w-24 px-4">
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {saving ? "Saving" : saved && !dirty ? "Saved" : "Save"}
          </Button>
        </div>
        )}

        {chosen && chosen.itemCount === 0 && (
          <p className="text-sm text-[#8a5a00]">That playlist is empty, so the screen would show nothing. Add posters to it first.</p>
        )}

        {screen.playlist ? (
          <p className="text-[15px]">
            Now playing <PlaylistName id={screen.playlist.id} name={screen.playlist.name} link={canEdit} />
            {screen.playlist.source !== "SCREEN" && <span className="text-muted-foreground"> ({SOURCE_TEXT[screen.playlist.source]})</span>}.
          </p>
        ) : (
          <p className="text-[15px] text-[#8a5a00]">
            {screen.scheduled.length ? "Nothing is playing right now." : canEdit ? "No playlist yet, so the TV shows a blank screen. Choose one above." : "No playlist yet, so the TV shows a blank screen."}
          </p>
        )}

        {screen.scheduled.length > 0 && (
          <div className="grid gap-1.5 rounded-lg bg-mist/60 px-3 py-2.5">
            <p className="text-sm font-medium">At set times it plays instead</p>
            <ul className="grid gap-1 text-sm">
              {screen.scheduled.map((s) => (
                <li key={`${s.source}-${s.id}-${s.slots.map(describeSlot).join()}`}>
                  <PlaylistName id={s.id} name={s.name} link={canEdit} />
                  <span className="text-muted-foreground">
                    {" "}
                    {s.slots.map(describeSlot).join("; ")}
                    {s.source !== "SCREEN" && ` (${SOURCE_TEXT[s.source]})`}
                  </span>
                </li>
              ))}
            </ul>
            {canEdit && (
              <Link href="/schedules" className="text-sm text-muted-foreground hover:text-foreground">
                Manage on Schedules
              </Link>
            )}
          </div>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Card>
  );
}

function SettingsCard({ screen, onSaved }: { screen: ScreenDetail; onSaved: (s: ScreenDetail) => void }) {
  const [name, setName] = useState(screen.name);
  const [branchId, setBranchId] = useState(screen.branch?.id ?? "");
  const [orientation, setOrientation] = useState<Orientation>(screen.orientation);
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BranchOption[]>("/api/branches")
      .then(setBranches)
      .catch((e: Error) => setError(e.message));
  }, []);

  const dirty = name.trim() !== screen.name || branchId !== (screen.branch?.id ?? "") || orientation !== screen.orientation;

  async function save() {
    setSaving(true);
    setError(null);
    const body: UpdateScreenRequest = { name: name.trim(), orientation, ...(branchId ? { branchId } : {}) };
    try {
      onSaved(await apiFetch<ScreenDetail>(`/api/screens/${screen.id}`, { method: "PATCH", body: JSON.stringify(body) }));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Card title="Screen details">
      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="screen-name">Name</Label>
          <Input id="screen-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-10 bg-card" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="screen-branch">Branch</Label>
          <NativeSelect id="screen-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!branches}>
            {!branchId && <option value="">Choose a branch</option>}
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.code ? ` (${b.code})` : ""}, {b.taluka}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <span className="text-sm leading-none font-medium">How the TV is mounted</span>
          <OrientationPicker value={orientation} onChange={setOrientation} />
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving || !name.trim()} className="h-10 px-4">
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save details
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** What this TV model can and cannot do, in plain words, as the TV found out for itself. */
function Capabilities({ caps }: { caps: ScreenDetail["capabilities"] }) {
  if (!caps) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">
        What this TV can do shows here once it runs the latest app.
      </p>
    );
  }
  const yt = youtubeSupport(caps);
  const signal = (dbm: number) => (dbm >= -60 ? "strong" : dbm >= -70 ? "fair" : "weak");
  const avc = caps.video?.avc ?? null;
  const hevc = caps.video?.hevc ?? null;
  const d = caps.display;
  const platform = caps.platform ? PLATFORM_NAMES[caps.platform] : null;
  type Row = [string, string, boolean | null];
  const rows: Row[] = [
    ...(caps.device
      ? ([["Made by", [caps.device.manufacturer, caps.device.model].filter(Boolean).join(" "), null]] as Row[])
      : []),
    ...(caps.device?.chipset ? ([["Chipset", caps.device.chipset, null]] as Row[]) : []),
    ...(caps.device?.os || platform
      ? ([["Software", [caps.device?.os, platform].filter(Boolean).join(", "), null]] as Row[])
      : []),
    ...(d
      ? ([
          [
            "Picture",
            `${d.width}x${d.height}` +
              (d.panelWidth && d.panelHeight && (d.panelWidth !== d.width || d.panelHeight !== d.height) ? ` on a ${d.panelWidth}x${d.panelHeight} panel` : "") +
              (d.refreshHz ? `, ${d.refreshHz} Hz` : ""),
            null,
          ],
        ] as Row[])
      : []),
    ["YouTube broadcasts", yt.ok ? "Yes" : yt.ok === false ? `No: ${yt.reason?.replace(/^has /, "")}` : "Not known", yt.ok],
    [
      "Our videos (H.264 1080p)",
      caps.h264_1080p === null
        ? "Not known"
        : caps.h264_1080p
          ? `Yes${avc ? ` (decoder up to ${avc.profile} ${avc.level})` : ""}`
          : `No: posters only are safe${avc ? ` (decoder up to ${avc.profile} ${avc.level})` : ""}`,
      caps.h264_1080p,
    ],
    ...(avc && caps.h264_1080p ? ([["Portrait videos", avc.portrait ? "Yes" : "No: use landscape videos on this TV", avc.portrait]] as Row[]) : []),
    ...(caps.video
      ? ([["H.265 (HEVC)", hevc ? (hevc.ours ? `Yes, up to ${hevc.profile} ${hevc.level}` : `Below 1080p (${hevc.profile} ${hevc.level})`) : "No decoder", null]] as Row[])
      : []),
    ["Kiosk mode and auto-start", caps.deviceOwner ? "Set up" : "Not set up (the app is not device owner)", caps.deviceOwner],
    [
      "Brightness from the dashboard",
      caps.brightness === null ? "Not tried yet" : caps.brightness ? "Works" : "Ignored: set it in the TV's picture settings",
      caps.brightness,
    ],
    [
      "Panel off outside hours",
      caps.screenOff === null
        ? "Not tested: nights stay black at the lowest backlight"
        : caps.screenOff
          ? "Works: the panel switches off and back on by itself"
          : "Not on this model: nights stay black at the lowest backlight",
      caps.screenOff,
    ],
    [
      "Restart the TV from here",
      caps.reboot === null ? "Needs a newer app" : caps.reboot ? "Works" : caps.deviceOwner ? "Refused by this TV" : "Needs kiosk mode",
      caps.reboot,
    ],
    [
      "Volume from here",
      caps.volume === null ? "Not tried yet" : caps.volume ? "Works" : "Not on this model: use the TV remote",
      caps.volume,
    ],
    [
      "Video in screenshots",
      caps.videoInScreenshot === null ? "Not known yet" : caps.videoInScreenshot ? "Yes" : "No: video areas show black",
      caps.videoInScreenshot,
    ],
    [
      "Network",
      caps.network.type === "ethernet"
        ? "Wired"
        : caps.network.type === "wifi"
          ? `Wi-Fi${caps.network.wifiDbm !== null ? `, ${signal(caps.network.wifiDbm)} signal (${caps.network.wifiDbm} dBm)` : ""}`
          : caps.network.type === "none"
            ? "Not connected"
            : "Other",
      caps.network.type === "wifi" && caps.network.wifiDbm !== null ? caps.network.wifiDbm >= -70 : null,
    ],
  ];
  return (
    <div className="border-t px-4 py-4 sm:px-5">
      <h3 className="mb-2 text-sm font-semibold">What this TV can do</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value, good]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("min-w-0 text-right", good === false && "text-[#6b4a00]")}>{value}</dd>
          </div>
        ))}
      </dl>
      {caps.video && caps.video.decoders.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Video decoders ({caps.video.decoders.length})</summary>
          <ul className="mt-2 grid gap-1 text-xs">
            {caps.video.decoders.map((dec) => (
              <li key={`${dec.name}-${dec.type}`} className="flex justify-between gap-4">
                <span className="min-w-0 break-all">{dec.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {dec.type}, {dec.hardware ? "hardware" : "software"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const THERMAL_TEXT: Record<string, string> = {
  none: "Normal",
  light: "Warm",
  moderate: "Warm: the TV may slow down",
  severe: "Hot: the TV is slowing down",
  critical: "Very hot",
  emergency: "Very hot: about to switch off",
  shutdown: "Switching off from heat",
};
const EXIT_TEXT: Record<string, string> = {
  crash: "the app crashed",
  nativeCrash: "the app crashed",
  anr: "the app stopped responding",
  lowMemory: "Android ran out of memory",
  signaled: "Android stopped it",
  exitSelf: "the app restarted itself",
  userRequested: "it was stopped from settings",
  excessiveResource: "it used too much power or memory",
};

/** The TV's own state from its last heartbeat (TV control E). */
function TvStatus({ status, now }: { status: ScreenDetail["tvStatus"]; now: number }) {
  if (!status) return null;
  const rows: [string, string][] = [];
  if (status.screenOn !== null) {
    rows.push([
      "Panel",
      status.nightMode === "panelOff"
        ? "Off for the night"
        : status.nightMode === "black"
          ? "Black for the night, lowest backlight"
          : status.screenOn
            ? "On"
            : "Off",
    ]);
  }
  if (status.bootedAt) rows.push(["Running since", `${formatAgo(status.bootedAt, now)}${status.bootReason ? ` (${status.bootReason})` : ""}`]);
  if (status.ip || status.networkType) {
    const kind = status.networkType === "ethernet" ? "Wired" : status.networkType === "wifi" ? "Wi-Fi" : status.networkType === "none" ? "Not connected" : status.networkType ?? "";
    rows.push(["Address", [kind, status.ip].filter(Boolean).join(", ")]);
  }
  if (status.thermal) rows.push(["Temperature", THERMAL_TEXT[status.thermal] ?? status.thermal]);
  if (status.volume !== null) rows.push(["Sound", status.muted ? `Muted (volume ${status.volume}%)` : `${status.volume}%`]);
  if (status.lastExit) rows.push(["App last stopped", `${formatAgo(status.lastExit.at, now)}: ${EXIT_TEXT[status.lastExit.reason] ?? status.lastExit.reason}`]);
  if (rows.length === 0) return null;
  return (
    <div className="border-t px-4 py-4 sm:px-5">
      <h3 className="mb-2 text-sm font-semibold">TV status</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("min-w-0 text-right", label === "Temperature" && status.thermal && !["none", "light"].includes(status.thermal) && "text-[#6b4a00]")}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Reported {formatAgo(status.reportedAt, now)}.</p>
    </div>
  );
}

const PLATFORM_NAMES: Record<NonNullable<NonNullable<ScreenDetail["capabilities"]>["platform"]>, string> = {
  googletv: "Google TV",
  androidtv: "Android TV",
  aosp: "Android without Google TV services",
};

/** The app's last crash, in a fold: the type and when, with the technical lines for whoever fixes it. */
function CrashNote({ crash, ago }: { crash: NonNullable<ScreenDetail["crash"]>; ago: string }) {
  const name = crash.type.split(".").pop() ?? crash.type;
  return (
    <details className="border-b px-4 py-2.5 text-sm sm:px-5">
      <summary className="cursor-pointer text-muted-foreground">
        Last crash {ago}: {name}
        {crash.recent > 1 ? `, ${crash.recent} in the last 10 minutes` : ""} ({crash.total} in all)
      </summary>
      <div className="mt-2 grid gap-1 text-xs">
        {crash.message && <p className="break-words">{crash.message}</p>}
        <pre className="overflow-x-auto rounded bg-mist px-2 py-1.5 text-[11px] leading-relaxed">{[crash.type, ...crash.frames.map((f) => `  at ${f}`)].join("\n")}</pre>
      </div>
    </details>
  );
}

/** How the TV keeps to the shared timeline, in words. */
function playbackText(s: ScreenDetail): string | null {
  const p = s.playSync;
  if (p && !p.clockCertain) return "Clock not set: waiting for the internet";
  if (!s.syncPlayback) return "Own pace (branch not kept in step)";
  if (!p) return null;
  if (p.mode === "free") return "Not in step yet: app update needed or waiting for its next check-in";
  const parts = [p.offsetErrorMs !== null ? `In step (±${p.offsetErrorMs} ms)` : "In step, clock still settling"];
  if (p.driftMs !== null) parts.push(`video ${Math.abs(p.driftMs)} ms ${p.driftMs > 0 ? "ahead" : "behind"}`);
  return parts.join(", ");
}

function mb(free: number | null, total: number | null): string | null {
  if (free === null) return null;
  const gb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
  return total ? `${gb(free)} free of ${gb(total)}` : `${gb(free)} free`;
}

function DeviceCard({
  screen,
  ago,
  now,
  canEdit,
  onReplaced,
}: {
  screen: ScreenDetail;
  ago: string | null;
  now: number;
  canEdit: boolean;
  onReplaced: (s: ScreenDetail) => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facts: [string, string | null][] = [
    ["Last check-in", ago],
    ["Screen on", screen.hours ? describeHours(screen.hours.hours) : "Always"],
    ["Model", screen.model],
    ["Android", screen.osVersion],
    ["App version", screen.appVersion],
    ["Resolution", screen.resolution],
    ["Network address", screen.ipAddress],
    ["Storage", mb(screen.storageFreeMb, screen.storageTotalMb)],
    ["Ad files", screen.files ? `${screen.files.ready} of ${screen.files.total} on the TV` : null],
    ["Playback", playbackText(screen)],
    ["Memory", mb(screen.ramFreeMb, screen.ramTotalMb)],
    ["Paired on", screen.pairedAt ? formatDay(screen.pairedAt) : null],
  ];

  async function remove() {
    setRemoving(true);
    try {
      await apiFetch(`/api/screens/${screen.id}`, { method: "DELETE" });
      router.push("/screens");
    } catch (e) {
      setError((e as Error).message);
      setRemoving(false);
      setConfirm(false);
    }
  }

  return (
    <aside className="grid gap-4">
      <section className="rounded-xl border bg-card">
        <div className="flex justify-center border-b bg-mist/50 px-4 py-6">
          <ScreenGlyph screen={screen} size="lg" />
        </div>
        <p className="border-b px-4 py-2.5 text-sm text-muted-foreground sm:px-5">
          {screen.online && screen.nowPlaying ? `Showing ${screen.nowPlaying.displayName}` : screen.online ? "Connected; it has not reported what is on screen yet" : "Not connected right now"}
        </p>
        {filesProblem(screen.files) && (
          <p role="status" className="border-b bg-haldi/15 px-4 py-2.5 text-sm text-[#6b4a00] sm:px-5">
            <span className="font-medium">{filesProblem(screen.files)}.</span>{" "}
            {screen.files?.error?.startsWith("storage full")
              ? "The TV keeps playing what it has. Make room: take big videos out of its playlists, or uninstall other apps on the TV."
              : "The TV keeps playing what it has and tries again on the next update."}
          </p>
        )}
        {screen.rescueMode && (
          <p role="status" className="border-b bg-destructive/[0.06] px-4 py-2.5 text-sm text-destructive sm:px-5">
            <span className="font-medium">Rescue mode: the default slide only.</span> This version of the app kept crashing, so the
            TV shows only the default slide, keeps checking for a fixed version and allows adb, for an hour after the last crash.
            Release a fixed version, or restart the app from this page to try again.
          </p>
        )}
        {screen.safeMode && !screen.rescueMode && (
          <p role="status" className="border-b bg-destructive/[0.06] px-4 py-2.5 text-sm text-destructive sm:px-5">
            <span className="font-medium">Safe mode: posters only.</span> The app crashed again and again, so for up to an hour it skips
            videos and live links. Restart the app from this page to try everything again.
          </p>
        )}
        {screen.unplayable.length > 0 && (
          <div role="status" className="border-b bg-haldi/15 px-4 py-2.5 text-sm text-[#6b4a00] sm:px-5">
            <p>
              <span className="font-medium">
                {screen.unplayable.length === 1 ? "1 video cannot play on this TV" : `${screen.unplayable.length} videos cannot play on this TV`}.
              </span>{" "}
              It skips {screen.unplayable.length === 1 ? "it" : "them"} and plays the rest; restarting the app tries again.
            </p>
            <ul className="mt-1 list-disc pl-5">
              {screen.unplayable.map((u) => (
                <li key={u.mediaId}>
                  {u.name}: {u.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {screen.tvOff && (
          <div role="status" className="border-b bg-haldi/15 px-4 py-2.5 text-sm text-[#6b4a00] sm:px-5">
            <p>
              <span className="font-medium">
                {screen.tvOff.kind === "screen"
                  ? "Turned off by the TV, not by Darpan"
                  : "Another input or app took the screen"}
              </span>{" "}
              during display hours, {formatAgo(screen.tvOff.at, now)}
              {screen.tvOff.backAt ? `; back ${formatAgo(screen.tvOff.backAt, now)}` : "; not back yet"}
              {screen.tvOff.count > 1 ? ` (${screen.tvOff.count} times in a day)` : ""}.
            </p>
            <p className="mt-0.5">
              {screen.tvOff.kind === "screen"
                ? "Switch off the TV's own sleep timer and auto power-off (often \"turn off when no signal\" or eco mode)."
                : "Set the TV to start on its home screen (power-on input or startup app), not on an HDMI input."}
            </p>
          </div>
        )}
        {screen.crash && <CrashNote crash={screen.crash} ago={formatAgo(screen.crash.at, now)} />}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-4 text-sm sm:px-5">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-right tabular-nums" title={value ?? undefined}>
                {value ?? <span className="text-muted-foreground/60">Not reported</span>}
              </dd>
            </div>
          ))}
        </dl>
        <Capabilities caps={screen.capabilities} />
        <TvStatus status={screen.tvStatus} now={now} />
      </section>

      {canEdit && <RemoteCard screen={screen} />}

      {canEdit && (
      <div className="rounded-xl border bg-card px-4 py-4 sm:px-5">
        <ReplaceTv screen={screen} onReplaced={onReplaced} />
        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
          Removing forgets this TV. If the app is still running it shows a new code and can be paired again.
        </p>
        <Button
          variant="ghost"
          onClick={() => setConfirm(true)}
          className="mt-3 h-9 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 data-icon="inline-start" />
          Remove screen
        </Button>
        {error && (
          <div className="mt-3">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{screen.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The TV stops getting updates and its playlist assignment is deleted. Play history for this screen is deleted too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Remove screen
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
