"use client";

import { useState, type FormEvent } from "react";
import type { ReplaceScreenRequest, ScreenDetail } from "@darpan/shared";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

/** Shows the code as "123 456" while typing; only digits are kept. */
function formatCode(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 6);
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

/**
 * A TV that was factory reset, or a new TV put up in its place, shows a fresh pairing code. Entering
 * it here moves this screen (name, branch, playlists, schedules, history) to that TV.
 */
export function ReplaceTv({ screen, onReplaced }: { screen: ScreenDetail; onReplaced: (s: ScreenDetail) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        TV factory reset, or a new TV in its place? It shows a new code. Enter it here to move this screen to that TV,
        with its name, playlists and history.
      </p>
      <Button variant="outline" onClick={() => setOpen(true)} className="mt-3 h-9 px-3">
        <RefreshCcw data-icon="inline-start" />
        Replace TV
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          {open && (
            <ReplaceForm
              screen={screen}
              onCancel={() => setOpen(false)}
              onDone={(s) => {
                setOpen(false);
                onReplaced(s);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReplaceForm({ screen, onCancel, onDone }: { screen: ScreenDetail; onCancel: () => void; onDone: (s: ScreenDetail) => void }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = code.replace(/\D/g, "");

  async function replace(e: FormEvent) {
    e.preventDefault();
    if (digits.length !== 6 || pending) return;
    setPending(true);
    setError(null);
    const body: ReplaceScreenRequest = { pairingCode: digits };
    try {
      onDone(await apiFetch<ScreenDetail>(`/api/screens/${screen.id}/replace`, { method: "POST", body: JSON.stringify(body) }));
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Replace the TV of “{screen.name}”</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          The new TV plays this screen’s playlists straight away. The old TV, if it is still switched on somewhere, stops
          getting updates.
        </DialogDescription>
      </div>
      <form onSubmit={replace} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="replace-code">Code on the new TV</Label>
          <Input
            id="replace-code"
            value={code}
            onChange={(e) => setCode(formatCode(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000 000"
            autoFocus
            className="h-14 bg-card text-center font-heading text-[30px] font-semibold tracking-[0.25em] tabular-nums placeholder:text-muted-foreground/40 md:text-[30px]"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onCancel} className="h-9">
            Cancel
          </Button>
          <Button type="submit" disabled={digits.length !== 6 || pending} className="h-9">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Replace TV
          </Button>
        </div>
      </form>
    </>
  );
}
