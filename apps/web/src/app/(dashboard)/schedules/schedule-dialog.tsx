"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PlaylistSummary, ScheduleEntry, TimeSlot } from "@darpan/shared";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { DayPicker, TargetPicker, TimeInput, type Target } from "./controls";
import { whereText } from "./format";
import { WeekBar } from "./week-bar";

interface SlotDraft {
  days: number[];
  allDay: boolean;
  start: string;
  end: string;
  dated: boolean;
  fromDate: string;
  toDate: string;
}

const newSlot = (): SlotDraft => ({ days: [1, 2, 3, 4, 5, 6], allDay: false, start: "09:00", end: "12:00", dated: false, fromDate: "", toDate: "" });

function toDraft(s: TimeSlot): SlotDraft {
  return {
    days: s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6],
    allDay: !s.start && !s.end,
    start: s.start ?? "00:00",
    end: s.end ?? "00:00",
    dated: !!(s.fromDate || s.toDate),
    fromDate: s.fromDate ?? "",
    toDate: s.toDate ?? "",
  };
}

function toSlot(d: SlotDraft): TimeSlot {
  return {
    days: d.days.length === 7 ? [] : d.days,
    start: d.allDay ? null : d.start || null,
    end: d.allDay ? null : d.end === "00:00" ? null : d.end || null,
    fromDate: d.dated ? d.fromDate || null : null,
    toDate: d.dated ? d.toDate || null : null,
  };
}

/** `entry` set = edit that schedule; otherwise add a new one. */
export function ScheduleDialog({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean;
  entry: ScheduleEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto p-6 sm:max-w-2xl">
        {open && <ScheduleForm key={entry?.id ?? "new"} entry={entry} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({ entry, onClose, onSaved }: { entry: ScheduleEntry | null; onClose: () => void; onSaved: () => void }) {
  const [target, setTarget] = useState<Target>({ level: entry?.level ?? "ALL", targetId: entry?.target?.id ?? "" });
  const [playlistId, setPlaylistId] = useState(entry?.playlist.id ?? "");
  const [slots, setSlots] = useState<SlotDraft[]>(entry ? entry.slots.map(toDraft) : [newSlot()]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PlaylistSummary[]>("/api/playlists")
      .then(setPlaylists)
      .catch((e: Error) => setError(e.message));
  }, []);

  const update = (i: number, patch: Partial<SlotDraft>) => setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const ready = playlistId && (target.level === "ALL" || target.targetId) && slots.every((s) => s.days.length);

  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = { playlistId, slots: slots.map(toSlot) };
    try {
      if (entry) await apiFetch(`/api/schedules/${entry.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else
        await apiFetch("/api/schedules", {
          method: "POST",
          body: JSON.stringify({ ...body, level: target.level, ...(target.level === "ALL" ? {} : { targetId: target.targetId }) }),
        });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">{entry ? "Edit timed playlist" : "Add a timed playlist"}</DialogTitle>
        <DialogDescription className="mt-1 max-w-xl text-sm text-muted-foreground">
          During these times it takes over from the main playlist. Outside them the screen goes back to its main playlist. Times are
          India time; TVs switch on their own, even without internet.
        </DialogDescription>
      </div>

      <form onSubmit={save} className="grid gap-5">
        {entry ? (
          <p className="text-[15px]">
            <span className="text-muted-foreground">Where: </span>
            {whereText(entry.level, entry.target)}
          </p>
        ) : (
          <TargetPicker value={target} onChange={setTarget} idPrefix="sch" />
        )}

        <div className="grid gap-2">
          <Label htmlFor="sch-playlist">Playlist</Label>
          <NativeSelect id="sch-playlist" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} disabled={!playlists}>
            <option value="">{playlists ? "Choose a playlist" : "Loading"}</option>
            {playlists?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.itemCount === 0 ? " (empty)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-3">
          {slots.map((s, i) => (
            <fieldset key={i} className="grid gap-4 rounded-lg border bg-mist/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">{slots.length > 1 ? `Time ${i + 1}` : "When"}</legend>
                {slots.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove time ${i + 1}`}
                    onClick={() => setSlots((all) => all.filter((_, j) => j !== i))}
                    className="size-8 text-muted-foreground"
                  >
                    <X />
                  </Button>
                )}
              </div>
              <DayPicker label="Days" value={s.days} onChange={(days) => update(i, { days })} />
              {!s.days.length && <p className="text-sm text-destructive">Choose at least one day.</p>}

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.allDay} onChange={(e) => update(i, { allDay: e.target.checked })} className="size-4 accent-neel" />
                  All day
                </label>
                {!s.allDay && (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`sch-start-${i}`}>From</Label>
                      <TimeInput id={`sch-start-${i}`} value={s.start} onChange={(start) => update(i, { start })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`sch-end-${i}`}>To</Label>
                      <TimeInput id={`sch-end-${i}`} value={s.end} onChange={(end) => update(i, { end })} />
                    </div>
                  </>
                )}
              </div>
              {!s.allDay && s.end && s.start && s.end !== "00:00" && s.end < s.start && (
                <p className="text-sm text-muted-foreground">Ends the next morning.</p>
              )}

              <div className="grid gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.dated} onChange={(e) => update(i, { dated: e.target.checked })} className="size-4 accent-neel" />
                  Only between certain dates (a campaign or festival)
                </label>
                {s.dated && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`sch-from-${i}`}>First day</Label>
                      <Input id={`sch-from-${i}`} type="date" value={s.fromDate} onChange={(e) => update(i, { fromDate: e.target.value })} className="h-10 w-44 bg-card" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`sch-to-${i}`}>Last day</Label>
                      <Input id={`sch-to-${i}`} type="date" value={s.toDate} onChange={(e) => update(i, { toDate: e.target.value })} className="h-10 w-44 bg-card" />
                    </div>
                  </div>
                )}
              </div>
            </fieldset>
          ))}
          {slots.length < 10 && (
            <Button type="button" variant="ghost" onClick={() => setSlots((all) => [...all, newSlot()])} className="h-9 justify-self-start text-neel">
              <Plus data-icon="inline-start" />
              Add another time
            </Button>
          )}
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Each week</span>
          <WeekBar slots={slots.filter((s) => s.days.length).map(toSlot)} />
        </div>

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
            {entry ? "Save" : "Add timed playlist"}
          </Button>
        </div>
      </form>
    </>
  );
}
