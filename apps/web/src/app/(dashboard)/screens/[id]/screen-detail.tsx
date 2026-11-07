"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { BranchOption, Orientation, PlaylistSummary, ScreenDetail, UpdateScreenRequest } from "@darpan/shared";
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
import { apiFetch } from "@/lib/api-client";
import { formatAgo, formatDay } from "@/lib/format";
import { OrientationPicker } from "../orientation-picker";
import { PairScreenButton } from "../pair-screen-dialog";
import { ScreenGlyph, ScreenStatusText } from "../screen-glyph";
import { SOURCE_TEXT } from "../screen-list";

const REFRESH_MS = 30_000;

export function ScreenDetailView() {
  const { id } = useParams<{ id: string }>();
  const [screen, setScreen] = useState<ScreenDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // set with each fetch; Date.now() is not allowed during prerender

  const accept = useCallback((s: ScreenDetail) => {
    setScreen(s);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const load = () =>
      apiFetch<ScreenDetail>(`/api/screens/${id}`)
        .then(accept)
        .catch((e: Error) => setLoadError(e.message));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [id, accept]);

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

      {!screen.paired && (
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
          <PlaylistCard screen={screen} onSaved={accept} />
          <SettingsCard key={screen.id + screen.name + screen.branch?.id + screen.orientation} screen={screen} onSaved={accept} />
        </div>
        <DeviceCard screen={screen} ago={ago} />
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

function PlaylistCard({ screen, onSaved }: { screen: ScreenDetail; onSaved: (s: ScreenDetail) => void }) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [choice, setChoice] = useState(screen.ownPlaylistId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<PlaylistSummary[]>("/api/playlists")
      .then(setPlaylists)
      .catch((e: Error) => setError(e.message));
  }, []);

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
    <Card title="What it plays" description="The TV picks up a change the next time it checks in.">
      <div className="grid gap-4">
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

        {chosen && chosen.itemCount === 0 && (
          <p className="text-sm text-[#8a5a00]">That playlist is empty, so the screen would show nothing. Add posters to it first.</p>
        )}

        {screen.playlist ? (
          <p className="text-[15px]">
            Now playing{" "}
            <Link href={`/playlists/${screen.playlist.id}`} className="font-medium text-neel hover:underline">
              {screen.playlist.name}
            </Link>
            {screen.playlist.source !== "SCREEN" && <span className="text-muted-foreground"> ({SOURCE_TEXT[screen.playlist.source]})</span>}.
          </p>
        ) : (
          <p className="text-[15px] text-[#8a5a00]">No playlist yet, so the TV shows a blank screen. Choose one above.</p>
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

function mb(free: number | null, total: number | null): string | null {
  if (free === null) return null;
  const gb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
  return total ? `${gb(free)} free of ${gb(total)}` : `${gb(free)} free`;
}

function DeviceCard({ screen, ago }: { screen: ScreenDetail; ago: string | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facts: [string, string | null][] = [
    ["Last check-in", ago],
    ["Model", screen.model],
    ["Android", screen.osVersion],
    ["App version", screen.appVersion],
    ["Resolution", screen.resolution],
    ["Network address", screen.ipAddress],
    ["Storage", mb(screen.storageFreeMb, screen.storageTotalMb)],
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
      </section>

      <div className="rounded-xl border bg-card px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">
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
