"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { IMAGE_SEC_MAX, IMAGE_SEC_MIN, type MediaItem, type PlaylistDetail, type UpdatePlaylistRequest } from "@darpan/shared";
import { ChevronLeft, Copy, ListVideo, Loader2, Play, Trash2 } from "lucide-react";
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
import { formatAgo, formatLoop } from "@/lib/format";
import { effectiveSec, issueOf, move, newKey, type DraftItem } from "./draft";
import { ItemRow } from "./item-row";
import { LoopPreview } from "./loop-preview";
import { MediaPicker } from "./media-picker";

function fromDetail(p: PlaylistDetail): DraftItem[] {
  return p.items.map((i) => ({ key: newKey(), media: i.media, durationSec: i.durationSec }));
}

function snapshot(name: string, defaultSec: number, items: DraftItem[]) {
  return JSON.stringify([name.trim(), defaultSec, items.map((i) => [i.media.id, i.durationSec])]);
}

export function PlaylistEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [saved, setSaved] = useState<PlaylistDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [defaultSecText, setDefaultSecText] = useState("10");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  const reset = useCallback((p: PlaylistDetail) => {
    setSaved(p);
    setName(p.name);
    setDefaultSecText(String(p.defaultImageSec));
    setItems(fromDetail(p));
  }, []);

  useEffect(() => {
    apiFetch<PlaylistDetail>(`/api/playlists/${id}`)
      .then(reset)
      .catch((e: Error) => setLoadError(e.message));
  }, [id, reset]);

  const defaultSec = Number(defaultSecText);
  const defaultValid = Number.isInteger(defaultSec) && defaultSec >= IMAGE_SEC_MIN && defaultSec <= IMAGE_SEC_MAX;
  const effectiveDefault = defaultValid ? defaultSec : (saved?.defaultImageSec ?? 10);
  const badItem = items.find((i) => i.durationSec !== null && (i.durationSec < IMAGE_SEC_MIN || i.durationSec > IMAGE_SEC_MAX));

  const dirty = saved !== null && snapshot(name, defaultSec, items) !== snapshot(saved.name, saved.defaultImageSec, fromDetail(saved));
  const canSave = dirty && !saving && name.trim().length > 0 && defaultValid && !badItem;

  const loopSec = useMemo(
    () => items.filter((i) => issueOf(i.media) === null).reduce((s, i) => s + effectiveSec(i, effectiveDefault), 0),
    [items, effectiveDefault],
  );
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.media.id, (m.get(i.media.id) ?? 0) + 1);
    return m;
  }, [items]);
  const skipCount = items.filter((i) => {
    const issue = issueOf(i.media);
    return issue === "failed" || issue === "ended";
  }).length;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const body: UpdatePlaylistRequest = {
      name: name.trim(),
      defaultImageSec: defaultSec,
      items: items.map((i) => ({ mediaId: i.media.id, durationSec: i.durationSec })),
    };
    try {
      reset(await apiFetch<PlaylistDetail>(`/api/playlists/${id}`, { method: "PATCH", body: JSON.stringify(body) }));
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }, [canSave, name, defaultSec, items, id, reset]);

  // Ctrl+S saves; warn before leaving with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [save, dirty]);

  function add(media: MediaItem) {
    setItems((list) => [...list, { key: newKey(), media, durationSec: null }]);
  }

  async function duplicate() {
    setBusy(true);
    try {
      const copy = await apiFetch<PlaylistDetail>(`/api/playlists/${id}/duplicate`, { method: "POST" });
      router.push(`/playlists/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/api/playlists/${id}`, { method: "DELETE" });
      router.push("/playlists");
    } catch (e) {
      setConfirmDelete(false);
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function dropAt(target: number) {
    if (!drag) return;
    // target is the index the item should end up before; adjust when moving down.
    const to = target > drag.from ? target - 1 : target;
    setItems((list) => move(list, drag.from, to));
    setDrag(null);
  }

  if (loadError) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">This playlist could not be opened.</p>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        <Link href="/playlists" className="mt-4 inline-block text-sm font-medium text-neel hover:underline">
          Back to playlists
        </Link>
      </div>
    );
  }
  if (!saved) return <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  return (
    <div>
      {/* Header */}
      <Link href="/playlists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Playlists
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="pl-title" className="sr-only">
            Playlist name
          </label>
          <input
            id="pl-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full rounded-md bg-transparent font-heading text-[28px] leading-tight font-semibold tracking-tight outline-none hover:bg-mist/60 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            {saved.assignmentCount
              ? `Playing on ${saved.assignmentCount} target${saved.assignmentCount === 1 ? "" : "s"}. Saved changes reach those screens on their next update.`
              : "Not on any screen yet. Assign it from the Screens page."}{" "}
            Edited {formatAgo(saved.updatedAt)}
            {saved.createdBy ? `, created by ${saved.createdBy}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={duplicate} disabled={busy} className="h-10 text-muted-foreground">
            <Copy data-icon="inline-start" />
            Duplicate
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
          <Button variant="outline" onClick={() => setPreviewing(true)} disabled={!items.length} className="h-10">
            <Play data-icon="inline-start" />
            Preview
          </Button>
          <Button onClick={save} disabled={!canSave} className="h-10 min-w-32 px-4 text-[15px]">
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {saving ? "Saving" : justSaved && !dirty ? "Saved" : "Save changes"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Items */}
        <section aria-labelledby="items-heading" className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-4 py-3 sm:px-5">
            <div>
              <h2 id="items-heading" className="font-heading text-lg font-semibold tracking-tight">
                Running order
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {items.length} item{items.length === 1 ? "" : "s"}, one loop takes {formatLoop(loopSec)}
                {dirty && <span className="ml-2 font-medium text-[#8a5a00]">Unsaved changes</span>}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Posters show for</span>
              <input
                type="number"
                inputMode="numeric"
                min={IMAGE_SEC_MIN}
                max={IMAGE_SEC_MAX}
                value={defaultSecText}
                onChange={(e) => setDefaultSecText(e.target.value)}
                aria-invalid={!defaultValid}
                className="h-8 w-16 rounded-md border border-input bg-card px-2 text-right tabular-nums focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none aria-invalid:border-destructive"
              />
              <span className="text-muted-foreground">s each</span>
            </label>
          </div>

          {(!defaultValid || badItem) && (
            <p className="border-b bg-destructive/[0.06] px-5 py-2 text-sm text-destructive">
              Poster times must be between {IMAGE_SEC_MIN} and {IMAGE_SEC_MAX} seconds
              {badItem ? ` (check “${badItem.media.displayName}”)` : ""}.
            </p>
          )}
          {skipCount > 0 && (
            <p className="border-b bg-[#fdf6e7] px-5 py-2 text-sm text-[#8a5a00]">
              {skipCount} item{skipCount === 1 ? " has" : "s have"} ended or failed. Screens skip {skipCount === 1 ? "it" : "them"}; remove {skipCount === 1 ? "it" : "them"} to keep the playlist tidy.
            </p>
          )}

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <span className="flex size-11 items-center justify-center rounded-lg bg-neel-soft text-neel">
                <ListVideo className="size-5" />
              </span>
              <p className="font-medium">No items yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Click posters and videos in <span className="xl:hidden">the media list below</span>
                <span className="hidden xl:inline">Add from media, on the right,</span> to put them in the loop. They play in this order, top to bottom, then repeat.
              </p>
            </div>
          ) : (
            <ol
              className="divide-y"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag?.over !== null && drag?.over !== undefined) dropAt(drag.over);
              }}
            >
              {items.map((item, i) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  index={i}
                  count={items.length}
                  defaultImageSec={effectiveDefault}
                  dragging={drag?.from === i}
                  dropBefore={drag !== null && drag.over === i && drag.from !== i && drag.from !== i - 1}
                  onDuration={(sec) => setItems((list) => list.map((x) => (x.key === item.key ? { ...x, durationSec: sec } : x)))}
                  onMove={(to) => setItems((list) => move(list, i, to))}
                  onRemove={() => setItems((list) => list.filter((x) => x.key !== item.key))}
                  onDragStart={() => setDrag({ from: i, over: null })}
                  onDragOver={(before) => setDrag((d) => (d ? { ...d, over: before ? i : i + 1 } : d))}
                  onDragEnd={() => setDrag(null)}
                  onDrop={() => drag?.over !== null && drag?.over !== undefined && dropAt(drag.over)}
                />
              ))}
              {drag !== null && drag.over === items.length && drag.from !== items.length - 1 && (
                <li aria-hidden className="h-0.5 bg-neel" />
              )}
            </ol>
          )}
        </section>

        {/* Library */}
        <div className="xl:sticky xl:top-6">
          <MediaPicker usage={usage} onAdd={add} />
        </div>
      </div>

      {previewing && <LoopPreview items={items} defaultImageSec={effectiveDefault} onClose={() => setPreviewing(false)} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{saved.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {saved.assignmentCount
                ? "It is assigned to screens. Unassign it on the Screens page first."
                : "The playlist is deleted. The posters and videos stay in the media library."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={busy || saved.assignmentCount > 0}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Delete playlist
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
