"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { DisplayHoursEntry, DisplayHoursValue, ScheduleEntry } from "@darpan/shared";
import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TargetPicker, type Target } from "./controls";
import { describeHours, describeSlot, whereText } from "./format";
import { DEFAULT_HOURS, HoursEditor } from "./hours-editor";
import { ScheduleDialog } from "./schedule-dialog";
import { WeekBar } from "./week-bar";

type HoursEdit = { entry: DisplayHoursEntry | null; level: "ALL" | null };
type Removal = { kind: "schedule"; entry: ScheduleEntry } | { kind: "hours"; entry: DisplayHoursEntry };

export function ScheduleView() {
  const [schedules, setSchedules] = useState<ScheduleEntry[] | null>(null);
  const [hours, setHours] = useState<DisplayHoursEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [hoursEdit, setHoursEdit] = useState<HoursEdit | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    Promise.all([apiFetch<ScheduleEntry[]>("/api/schedules"), apiFetch<DisplayHoursEntry[]>("/api/display-hours")])
      .then(([s, h]) => {
        setSchedules(s);
        setHours(h);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // keeps "Playing now" current
    return () => clearInterval(t);
  }, [load]);

  async function remove() {
    if (!removal) return;
    setRemoving(true);
    try {
      if (removal.kind === "schedule") await apiFetch(`/api/schedules/${removal.entry.id}`, { method: "DELETE" });
      else
        await apiFetch("/api/display-hours", {
          method: "PUT",
          body: JSON.stringify({ level: removal.entry.level, targetId: removal.entry.target?.id, hours: null }),
        });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
    setRemoving(false);
    setRemoval(null);
  }

  if (!schedules || !hours) {
    return error ? (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    ) : (
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    );
  }

  const all = hours.find((h) => h.level === "ALL") ?? null;
  const overrides = hours.filter((h) => h.level !== "ALL");
  const current = schedules.filter((s) => !s.expired);
  const ended = schedules.filter((s) => s.expired);

  return (
    <div className="grid gap-8">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ---- Display hours ---- */}
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="max-w-xl">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Display hours</h2>
            <p className="text-sm text-muted-foreground">
              Outside these hours the TV shows a black screen and stops playing. A branch or screen can have its own hours.
            </p>
          </div>
        </div>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg", all ? "bg-neel-soft text-neel" : "bg-mist text-muted-foreground")}>
              <Power className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="font-medium">Every screen</p>
              <p className="text-[15px] text-muted-foreground">{all ? describeHours(all.hours) : "Always on: no hours set."}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button variant="outline" onClick={() => setHoursEdit({ entry: all, level: "ALL" })} className="h-9 px-3">
                  {all ? "Change hours" : "Set hours"}
                </Button>
                {all && (
                  <Button variant="ghost" onClick={() => setRemoval({ kind: "hours", entry: all })} className="h-9 px-3 text-muted-foreground">
                    Keep always on
                  </Button>
                )}
              </div>
            </div>
          </div>
          {all && <WeekBar hours={all.hours} className="lg:pt-1" />}
        </div>

        {overrides.length > 0 && (
          <ul className="border-t">
            {overrides.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="min-w-0">
                  <p className="font-medium">{whereText(h.level, h.target)}</p>
                  <p className="text-sm text-muted-foreground">{describeHours(h.hours)}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Change hours for ${whereText(h.level, h.target)}`} onClick={() => setHoursEdit({ entry: h, level: null })} className="size-9 text-muted-foreground">
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove hours for ${whereText(h.level, h.target)}`}
                    onClick={() => setRemoval({ kind: "hours", entry: h })}
                    className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2.5 sm:px-5">
          <Button variant="ghost" onClick={() => setHoursEdit({ entry: null, level: null })} className="h-9 px-2.5 text-neel">
            <Plus data-icon="inline-start" />
            Different hours for a region, branch or screen
          </Button>
        </div>
      </section>

      {/* ---- Timed playlists ---- */}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-xl">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Timed playlists</h2>
            <p className="text-sm text-muted-foreground">
              Play a playlist only at certain times, such as a loan offer on weekday mornings or a festival loop for a few days. The
              rest of the time, screens play their main playlist.
            </p>
          </div>
          <Button onClick={() => setAdding(true)} className="h-10 px-4">
            <Plus data-icon="inline-start" />
            Add timed playlist
          </Button>
        </div>

        {current.length === 0 && (
          <p className="rounded-xl border border-dashed bg-card px-5 py-8 text-center text-muted-foreground">No timed playlists yet.</p>
        )}
        {current.map((s) => (
          <ScheduleRow key={s.id} entry={s} onEdit={() => setEditing(s)} onRemove={() => setRemoval({ kind: "schedule", entry: s })} />
        ))}

        {ended.length > 0 && (
          <details className="group mt-2">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              {ended.length} ended {ended.length === 1 ? "schedule" : "schedules"} (no longer sent to TVs)
            </summary>
            <div className="mt-3 grid gap-3 opacity-70">
              {ended.map((s) => (
                <ScheduleRow key={s.id} entry={s} onEdit={() => setEditing(s)} onRemove={() => setRemoval({ kind: "schedule", entry: s })} />
              ))}
            </div>
          </details>
        )}
      </section>

      <ScheduleDialog
        open={adding || editing !== null}
        entry={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          load();
        }}
      />

      <HoursDialog
        edit={hoursEdit}
        onClose={() => setHoursEdit(null)}
        onSaved={(h) => {
          setHours(h);
          setHoursEdit(null);
        }}
      />

      <AlertDialog open={removal !== null} onOpenChange={(o) => !o && setRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removal?.kind === "schedule"
                ? `Delete the timed playlist “${removal.entry.playlist.name}”?`
                : removal?.entry.level === "ALL"
                  ? "Keep screens always on?"
                  : `Remove the hours for ${removal ? whereText(removal.entry.level, removal.entry.target) : ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.kind === "schedule"
                ? "Screens go back to their main playlist at those times. The playlist itself is not deleted."
                : removal?.entry.level === "ALL"
                  ? "Screens with no hours of their own will stay on day and night."
                  : "It will follow the hours set above it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {removal?.kind === "schedule" ? "Delete" : "Remove hours"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScheduleRow({ entry, onEdit, onRemove }: { entry: ScheduleEntry; onEdit: () => void; onRemove: () => void }) {
  return (
    <article className="grid gap-4 rounded-xl border bg-card px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)_auto] md:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/playlists/${entry.playlist.id}`} className="font-heading text-lg font-semibold tracking-tight hover:text-neel">
            {entry.playlist.name}
          </Link>
          {entry.activeNow && <span className="rounded bg-ok/10 px-1.5 text-xs font-medium text-ok">Playing now</span>}
          {entry.expired && <span className="rounded bg-mist px-1.5 text-xs font-medium text-muted-foreground">Ended</span>}
        </p>
        <p className="text-sm">{whereText(entry.level, entry.target)}</p>
        <ul className="mt-1 text-sm text-muted-foreground">
          {entry.slots.map((slot, i) => (
            <li key={i}>{describeSlot(slot)}</li>
          ))}
        </ul>
      </div>
      <WeekBar slots={entry.slots} />
      <div className="flex gap-1 justify-self-end">
        <Button variant="ghost" size="icon" aria-label={`Edit ${entry.playlist.name} schedule`} onClick={onEdit} className="size-9 text-muted-foreground">
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${entry.playlist.name} schedule`}
          onClick={onRemove}
          className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </article>
  );
}

function HoursDialog({ edit, onClose, onSaved }: { edit: HoursEdit | null; onClose: () => void; onSaved: (h: DisplayHoursEntry[]) => void }) {
  return (
    <Dialog open={edit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto p-6 sm:max-w-xl">
        {edit && <HoursForm key={edit.entry?.id ?? edit.level ?? "new"} edit={edit} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function HoursForm({ edit, onClose, onSaved }: { edit: HoursEdit; onClose: () => void; onSaved: (h: DisplayHoursEntry[]) => void }) {
  const fixed = edit.entry ?? (edit.level === "ALL" ? { level: "ALL" as const, target: null } : null);
  const [target, setTarget] = useState<Target>({ level: "BRANCH", targetId: "" });
  const [value, setValue] = useState<DisplayHoursValue>(edit.entry?.hours ?? DEFAULT_HOURS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const level = fixed ? fixed.level : target.level;
  const targetId = fixed ? fixed.target?.id : target.targetId;
  const ready = value.days.length > 0 && value.on && value.off && (level === "ALL" || targetId);

  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      onSaved(
        await apiFetch<DisplayHoursEntry[]>("/api/display-hours", {
          method: "PUT",
          body: JSON.stringify({ level, ...(level === "ALL" ? {} : { targetId }), hours: value }),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">
          {fixed ? `Display hours: ${whereText(fixed.level, fixed.target)}` : "Different display hours"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          India time. The closest setting wins: a screen&apos;s own hours beat its branch, which beat every screen.
        </DialogDescription>
      </div>
      <form onSubmit={save} className="grid gap-5">
        {!fixed && <TargetPicker value={target} onChange={(t) => setTarget(t.level === "ALL" ? { level: "BRANCH", targetId: "" } : t)} idPrefix="hrs" />}
        <HoursEditor value={value} onChange={setValue} idPrefix="hrs" />
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="h-9">
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !ready} className="h-9">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save hours
          </Button>
        </div>
      </form>
    </>
  );
}
