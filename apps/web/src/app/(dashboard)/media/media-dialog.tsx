"use client";

import { useState, type FormEvent } from "react";
import { goToSignInExpired } from "@/lib/session-expired";
import type { MediaItem, UpdateMediaRequest } from "@darpan/shared";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes, formatDay, formatDuration, fromDateInput, toDateInput } from "@/lib/format";

async function api(path: string, init: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  if (res.status === 401) goToSignInExpired();
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { message?: string | string[] })?.message?.toString() ?? `Request failed (${res.status})`);
  return body;
}

interface DialogProps {
  item: MediaItem | null;
  onClose: () => void;
  onChanged: () => void;
}

export function MediaDialog({ item, ...rest }: DialogProps) {
  if (!item) return null;
  // Keyed by id so the form starts fresh for each item opened.
  return <MediaDialogBody key={item.id} media={item} {...rest} />;
}

function MediaDialogBody({ media, onClose, onChanged }: Omit<DialogProps, "item"> & { media: MediaItem }) {
  const [name, setName] = useState(media.displayName);
  const [start, setStart] = useState(toDateInput(media.startDate));
  const [end, setEnd] = useState(toDateInput(media.endDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = name.trim() !== media.displayName || start !== toDateInput(media.startDate) || end !== toDateInput(media.endDate);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (start && end && end < start) {
      setError("The last day must be on or after the first day.");
      return;
    }
    setSaving(true);
    setError(null);
    const body: UpdateMediaRequest = {
      displayName: name.trim(),
      startDate: fromDateInput(start, "start"),
      endDate: fromDateInput(end, "end"),
    };
    try {
      await api(`/api/media/${media.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  async function retry() {
    try {
      await api(`/api/media/${media.id}/retry`, { method: "POST" });
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api(`/api/media/${media.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch (err) {
      setConfirmDelete(false);
      setError((err as Error).message);
    }
    setDeleting(false);
  }

  const portrait = (media.height ?? 0) > (media.width ?? 0);

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <div className="grid md:grid-cols-[1.25fr_1fr]">
            {/* Preview */}
            <div className="flex aspect-video items-center justify-center bg-ink md:aspect-auto md:min-h-[360px]">
              {media.fileUrl && media.type === "VIDEO" ? (
                <video src={media.fileUrl} controls preload="metadata" className="max-h-[420px] w-full" />
              ) : media.fileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
                <img src={media.fileUrl} alt={media.displayName} className={portrait ? "max-h-[420px] w-auto" : "w-full"} />
              ) : (
                <p className="px-6 text-center text-sm text-white/70">
                  {media.status === "FAILED" ? "No preview: processing failed." : "Preview appears once processing finishes."}
                </p>
              )}
            </div>

            {/* Details */}
            <form onSubmit={save} className="flex flex-col gap-5 p-5 sm:p-6">
              <div>
                <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Media details</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {media.type === "VIDEO" ? "Video" : "Image"}
                  {media.width ? `, ${media.width}×${media.height}` : ""}
                  {media.durationSec ? `, ${formatDuration(media.durationSec)}` : ""}, {formatBytes(media.sizeBytes)}
                </DialogDescription>
              </div>

              {media.status === "FAILED" && (
                <div className="rounded-md border border-destructive/25 bg-destructive/[0.06] p-3 text-sm">
                  <p className="font-medium text-destructive">Processing failed</p>
                  <p className="mt-0.5 break-words text-destructive/90">{media.errorMessage}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
                    <RotateCcw data-icon="inline-start" />
                    Try again
                  </Button>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="media-name">Name</Label>
                <Input id="media-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required className="h-10 bg-card" />
                <p className="text-sm text-muted-foreground" title={media.originalName}>
                  Uploaded as <span className="break-all">{media.originalName}</span>
                </p>
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">When it shows on screens</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="media-start" className="text-sm font-normal text-muted-foreground">
                      First day
                    </Label>
                    <Input id="media-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-10 bg-card" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="media-end" className="text-sm font-normal text-muted-foreground">
                      Last day
                    </Label>
                    <Input id="media-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="h-10 bg-card" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Leave blank to show it with no limit. Screens stop showing it after the last day.</p>
              </fieldset>

              {error && (
                <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onClose} className="h-9">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!dirty || saving || !name.trim()} className="h-9">
                    {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                    Save changes
                  </Button>
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                Added {formatDay(media.createdAt)}
                {media.uploadedBy ? ` by ${media.uploadedBy}` : ""}
                {media.usedInPlaylists > 0 ? `. In ${media.usedInPlaylists} playlist${media.usedInPlaylists === 1 ? "" : "s"}.` : "."}
              </p>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{media.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {media.usedInPlaylists > 0
                ? `It is in ${media.usedInPlaylists} playlist${media.usedInPlaylists === 1 ? "" : "s"}. Remove it from those first.`
                : "The file is removed from the library and from disk. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={deleting || media.usedInPlaylists > 0}>
              {deleting && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Delete media
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
