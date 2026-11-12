"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BranchOption, ClaimScreenRequest, Orientation, PlaylistSummary, ScreenDetail } from "@darpan/shared";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCanEdit } from "@/components/session-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { OrientationPicker } from "./orientation-picker";

/** Shows the code as "123 456" while typing; only digits are kept. */
function formatCode(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 6);
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

export function PairScreenButton({ label = "Pair a screen" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const canEdit = useCanEdit();
  if (!canEdit) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-10 px-4 text-[15px]">
        <Plus data-icon="inline-start" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">{open && <PairForm onCancel={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function PairForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("LANDSCAPE");
  const [playlistId, setPlaylistId] = useState("");
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BranchOption[]>("/api/branches")
      .then((b) => {
        setBranches(b);
        if (b.length === 1) setBranchId(b[0].id);
      })
      .catch((e: Error) => setError(e.message));
    apiFetch<PlaylistSummary[]>("/api/playlists").then(setPlaylists).catch(() => undefined);
  }, []);

  const digits = code.replace(/\D/g, "");
  const ready = digits.length === 6 && name.trim() && branchId && !pending;

  async function pair(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    const body: ClaimScreenRequest = { pairingCode: digits, name: name.trim(), branchId, orientation, playlistId: playlistId || null };
    try {
      const s = await apiFetch<ScreenDetail>("/api/screens/claim", { method: "POST", body: JSON.stringify(body) });
      router.push(`/screens/${s.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Pair a screen</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Turn on the TV with the Darpan app. It shows a 6-digit code; type it here.
        </DialogDescription>
      </div>
      <form onSubmit={pair} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="pair-code">Code on the TV</Label>
          <Input
            id="pair-code"
            value={code}
            onChange={(e) => setCode(formatCode(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000 000"
            autoFocus
            aria-describedby="pair-code-help"
            className="h-14 bg-card text-center font-heading text-[30px] font-semibold tracking-[0.25em] tabular-nums placeholder:text-muted-foreground/40 md:text-[30px]"
          />
          <p id="pair-code-help" className="text-sm text-muted-foreground">
            Codes last 30 minutes. If it has changed on the TV, use the new one.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="pair-name">Screen name</Label>
          <Input
            id="pair-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="For example: Nadiad main hall"
            maxLength={80}
            className="h-10 bg-card"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="pair-branch">Branch</Label>
          <NativeSelect id="pair-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!branches}>
            <option value="" disabled>
              {branches ? "Choose a branch" : "Loading branches…"}
            </option>
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

        <div className="grid gap-2">
          <Label htmlFor="pair-playlist">Playlist</Label>
          <NativeSelect id="pair-playlist" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
            <option value="">None for now</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
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
          <Button type="submit" disabled={!ready} className="h-9">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Pair screen
          </Button>
        </div>
      </form>
    </>
  );
}
