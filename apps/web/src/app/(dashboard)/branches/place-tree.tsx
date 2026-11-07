"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlaceLevel, PlacePlaylist, PlaceTree, PlaylistSummary, ScreenCounts } from "@darpan/shared";
import { Building2, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EmptyState } from "../empty-state";
import { ImportBranchesButton } from "./import-dialog";
import { PlaceDialog, type PlaceEdit } from "./place-dialog";

type Removal = { kind: "region" | "taluka" | "branch"; id: string; name: string };

export function PlaceTreeView() {
  const [tree, setTree] = useState<PlaceTree | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<PlaceEdit | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      apiFetch<PlaceTree>("/api/places")
        .then((t) => {
          setTree(t);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
    apiFetch<PlaylistSummary[]>("/api/playlists")
      .then(setPlaylists)
      .catch((e: Error) => setError(e.message));
  }, [load]);

  const setPlaylist = useCallback(async (level: PlaceLevel, id: string | undefined, playlistId: string | null) => {
    try {
      setTree(await apiFetch<PlaceTree>("/api/places/playlist", { method: "PUT", body: JSON.stringify({ level, id, playlistId }) }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  async function remove() {
    if (!removal) return;
    setRemoving(true);
    try {
      const path = removal.kind === "branch" ? "branches" : `${removal.kind}s`;
      await apiFetch(`/api/${path}/${removal.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setRemoving(false);
    setRemoval(null);
  }

  const visible = useMemo(() => (tree ? filterTree(tree, query) : null), [tree, query]);

  if (!tree) {
    return error ? (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    ) : (
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    );
  }

  const branchCount = tree.regions.reduce((n, r) => n + r.talukas.reduce((m, t) => m + t.branches.length, 0), 0);

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-4 sm:px-5">
        <div className="max-w-md">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Every screen</h2>
          <p className="text-sm text-muted-foreground">
            Plays on any screen that has nothing set for its region, taluka, branch or itself.
          </p>
        </div>
        <div className="w-full sm:w-[280px]">
          <PlaylistPicker
            label="Playlist for every screen"
            value={tree.allPlaylist}
            inherited={null}
            playlists={playlists}
            onChange={(p) => setPlaylist("ALL", undefined, p)}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={branchCount === 1 ? "Find a branch" : `Find among ${branchCount} branches`}
            aria-label="Find a branch, taluka or region"
            className="h-10 bg-card pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportBranchesButton onImported={() => void load()} />
          <Button variant="outline" onClick={() => setEdit({ kind: "region" })} className="h-10 px-4">
            <Plus data-icon="inline-start" />
            Add region
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {tree.regions.length === 0 ? (
        <EmptyState icon={Building2} title="No regions yet">
          Add a region, then its talukas and branches, or import the whole list from Excel. Screens are paired to a branch.
        </EmptyState>
      ) : visible!.regions.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Nothing matches “{query}”.</p>
      ) : (
        visible!.regions.map((r) => (
          <section key={r.id} className="overflow-hidden rounded-xl border bg-card">
            <Row
              depth={0}
              title={r.name}
              counts={r.screens}
              picker={
                <PlaylistPicker
                  label={`Playlist for region ${r.name}`}
                  value={r.playlist}
                  inherited={tree.allPlaylist ? { from: "every screen", playlist: tree.allPlaylist } : null}
                  playlists={playlists}
                  onChange={(p) => setPlaylist("REGION", r.id, p)}
                />
              }
              addLabel="Add taluka"
              onAdd={() => setEdit({ kind: "taluka", regionId: r.id })}
              onEdit={() => setEdit({ kind: "region", id: r.id, name: r.name })}
              onRemove={() => setRemoval({ kind: "region", id: r.id, name: r.name })}
            />
            {r.talukas.length === 0 && <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">No talukas yet.</p>}
            {r.talukas.map((t) => {
              const fromRegion = r.playlist
                ? { from: "region", playlist: r.playlist }
                : tree.allPlaylist
                  ? { from: "every screen", playlist: tree.allPlaylist }
                  : null;
              return (
                <div key={t.id} className="border-t">
                  <Row
                    depth={1}
                    title={t.name}
                    counts={t.screens}
                    picker={
                      <PlaylistPicker
                        label={`Playlist for taluka ${t.name}`}
                        value={t.playlist}
                        inherited={fromRegion}
                        playlists={playlists}
                        onChange={(p) => setPlaylist("TALUKA", t.id, p)}
                      />
                    }
                    addLabel="Add branch"
                    onAdd={() => setEdit({ kind: "branch", talukaId: t.id })}
                    onEdit={() => setEdit({ kind: "taluka", id: t.id, name: t.name, regionId: r.id })}
                    onRemove={() => setRemoval({ kind: "taluka", id: t.id, name: t.name })}
                  />
                  {t.branches.length === 0 && (
                    <p className="py-2.5 pr-4 pl-8 text-sm text-muted-foreground sm:pl-10">No branches yet.</p>
                  )}
                  <ul>
                    {t.branches.map((b) => (
                      <li key={b.id} className="border-t border-dashed">
                        <Row
                          depth={2}
                          title={b.name}
                          code={b.code}
                          counts={b.screens}
                          picker={
                            <PlaylistPicker
                              label={`Playlist for branch ${b.name}`}
                              value={b.playlist}
                              inherited={t.playlist ? { from: "taluka", playlist: t.playlist } : fromRegion}
                              playlists={playlists}
                              onChange={(p) => setPlaylist("BRANCH", b.id, p)}
                            />
                          }
                          onEdit={() =>
                            setEdit({ kind: "branch", id: b.id, name: b.name, code: b.code, address: b.address, talukaId: t.id })
                          }
                          onRemove={() => setRemoval({ kind: "branch", id: b.id, name: b.name })}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))
      )}

      <PlaceDialog
        edit={edit}
        tree={tree}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void load();
        }}
      />

      <AlertDialog open={removal !== null} onOpenChange={(o) => !o && setRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{removal?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.kind === "branch"
                ? "Only a branch with no screens can be deleted. A playlist set on it is removed too."
                : `Only an empty ${removal?.kind} can be deleted. A playlist set on it is removed too.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Keeps regions/talukas whose own name matches (with everything under them) or that contain a matching branch. */
function filterTree(tree: PlaceTree, query: string): PlaceTree {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return tree;
  const hit = (s: string | null) => !!s && s.toLocaleLowerCase().includes(q);
  const regions = tree.regions.flatMap((r) => {
    if (hit(r.name)) return [r];
    const talukas = r.talukas.flatMap((t) => {
      if (hit(t.name)) return [t];
      const branches = t.branches.filter((b) => hit(b.name) || hit(b.code) || hit(b.address));
      return branches.length ? [{ ...t, branches }] : [];
    });
    return talukas.length ? [{ ...r, talukas }] : [];
  });
  return { ...tree, regions };
}

function countText(c: ScreenCounts): string {
  if (!c.total) return "No screens";
  return `${c.total} screen${c.total === 1 ? "" : "s"}, ${c.online} online`;
}

function Row({
  depth,
  title,
  code,
  counts,
  picker,
  addLabel,
  onAdd,
  onEdit,
  onRemove,
}: {
  depth: 0 | 1 | 2;
  title: string;
  code?: string | null;
  counts: ScreenCounts;
  picker: React.ReactNode;
  addLabel?: string;
  onAdd?: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        // Narrow: name and buttons on one line, playlist below. Wide: one line, pickers aligned in a column.
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 pr-3 sm:pr-4 xl:grid-cols-[minmax(0,1fr)_280px_184px]",
        depth === 0 && "bg-mist/60 pl-4 sm:pl-5",
        depth === 1 && "pl-6 sm:pl-8",
        depth === 2 && "py-2.5 pl-10 sm:pl-14",
      )}
    >
      <div className="min-w-0">
        <p className={cn("flex items-baseline gap-2", depth === 0 ? "font-heading text-lg font-semibold tracking-tight" : depth === 1 ? "font-semibold" : "")}>
          <span className="truncate">{title}</span>
          {code && <span className="rounded bg-mist px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{code}</span>}
        </p>
        <p className={cn("text-sm", counts.total && counts.online < counts.total ? "text-[#8a5a00]" : "text-muted-foreground")}>
          {countText(counts)}
        </p>
      </div>
      <div className="order-3 col-span-2 sm:max-w-sm xl:order-2 xl:col-span-1 xl:max-w-none">{picker}</div>
      <div className="order-2 flex items-center gap-1 justify-self-end xl:order-3">
        {onAdd && (
          <Button variant="ghost" onClick={onAdd} className="h-9 px-2.5 text-sm text-neel">
            <Plus data-icon="inline-start" />
            {addLabel}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${title}`} className="size-9 text-muted-foreground">
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Delete ${title}`}
          className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/** Saves as soon as a different playlist is picked. The empty option means "follow the level above". */
function PlaylistPicker({
  label,
  value,
  inherited,
  playlists,
  onChange,
}: {
  label: string;
  value: PlacePlaylist | null;
  inherited: { from: string; playlist: PlacePlaylist } | null;
  playlists: PlaylistSummary[];
  onChange: (playlistId: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const known = !value || playlists.some((p) => p.id === value.id);

  async function change(id: string) {
    setSaving(true);
    await onChange(id || null);
    setSaving(false);
  }

  return (
    <div className="relative flex w-full min-w-0 items-center gap-2">
      <NativeSelect
        aria-label={label}
        value={value?.id ?? ""}
        onChange={(e) => void change(e.target.value)}
        disabled={saving}
        className={cn("min-w-0 flex-1", !value && "[&_select]:text-muted-foreground")}
      >
        <option value="">{inherited ? `Same as ${inherited.from}: ${inherited.playlist.name}` : "No playlist"}</option>
        {!known && value && <option value={value.id}>{value.name}</option>}
        {playlists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      {saving && <Loader2 aria-label="Saving" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}
