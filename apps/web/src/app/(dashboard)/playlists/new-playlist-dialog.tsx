"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_SEC_MAX, IMAGE_SEC_MIN, type PlaylistDetail } from "@darpan/shared";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

export function NewPlaylistButton({ label = "New playlist" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [seconds, setSeconds] = useState("10");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const p = await apiFetch<PlaylistDetail>("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ name, defaultImageSec: Number(seconds) }),
      });
      router.push(`/playlists/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-10 px-4 text-[15px]">
        <Plus data-icon="inline-start" />
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <div>
            <DialogTitle className="font-heading text-xl font-semibold tracking-tight">New playlist</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              You add posters and videos on the next screen.
            </DialogDescription>
          </div>
          <form onSubmit={create} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="pl-name">Name</Label>
              <Input
                id="pl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="For example: Diwali 2026 branch loop"
                maxLength={120}
                required
                autoFocus
                className="h-10 bg-card"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pl-sec">Each poster shows for</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pl-sec"
                  type="number"
                  inputMode="numeric"
                  min={IMAGE_SEC_MIN}
                  max={IMAGE_SEC_MAX}
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                  className="h-10 w-24 bg-card tabular-nums"
                  required
                />
                <span className="text-muted-foreground">seconds</span>
              </div>
              <p className="text-sm text-muted-foreground">Videos always play to the end. You can change any single poster later.</p>
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()} className="h-9">
                {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                Create playlist
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
