"use client";

import { useState, type FormEvent } from "react";
import type { PlaceTree } from "@darpan/shared";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";

/** What the dialog is adding or editing. */
export type PlaceEdit =
  | { kind: "region"; id?: string; name?: string }
  | { kind: "taluka"; id?: string; name?: string; regionId: string }
  | { kind: "branch"; id?: string; name?: string; code?: string | null; address?: string | null; talukaId: string };

const NOUN = { region: "region", taluka: "taluka", branch: "branch" } as const;

export function PlaceDialog({
  edit,
  tree,
  onClose,
  onSaved,
}: {
  edit: PlaceEdit | null;
  tree: PlaceTree;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={edit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        {edit && <PlaceForm key={`${edit.kind}:${edit.id ?? "new"}`} edit={edit} tree={tree} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function PlaceForm({ edit, tree, onClose, onSaved }: { edit: PlaceEdit; tree: PlaceTree; onClose: () => void; onSaved: () => void }) {
  const isNew = !edit.id;
  const noun = NOUN[edit.kind];
  const [name, setName] = useState(edit.name ?? "");
  const [code, setCode] = useState(edit.kind === "branch" ? (edit.code ?? "") : "");
  const [address, setAddress] = useState(edit.kind === "branch" ? (edit.address ?? "") : "");
  const [parentId, setParentId] = useState(edit.kind === "taluka" ? edit.regionId : edit.kind === "branch" ? edit.talukaId : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const talukaOptions = tree.regions.flatMap((r) => r.talukas.map((t) => ({ id: t.id, label: `${t.name} (${r.name})` })));

  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    let body: Record<string, unknown> = { name };
    if (edit.kind === "taluka") body = { ...body, regionId: parentId };
    if (edit.kind === "branch") body = { ...body, code: code || null, address: address || null, talukaId: parentId };
    const path = `/api/${edit.kind === "branch" ? "branches" : `${edit.kind}s`}${isNew ? "" : `/${edit.id}`}`;
    try {
      await apiFetch(path, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">
          {isNew ? `Add a ${noun}` : `Edit ${edit.name}`}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {edit.kind === "region" && "Regions group talukas, so one playlist can go to a whole area."}
          {edit.kind === "taluka" && "Talukas group branches inside a region."}
          {edit.kind === "branch" && "Screens are paired to a branch. Names can be in Gujarati."}
        </DialogDescription>
      </div>
      <form onSubmit={save} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="place-name">Name</Label>
          <Input
            id="place-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={edit.kind === "branch" ? 120 : 80}
            required
            autoFocus
            className="h-10 bg-card"
          />
        </div>

        {edit.kind === "taluka" && !isNew && (
          <div className="grid gap-2">
            <Label htmlFor="place-parent">Region</Label>
            <NativeSelect id="place-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {tree.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        {edit.kind === "branch" && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="place-code">Branch code</Label>
              <Input
                id="place-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={20}
                placeholder="Optional, for example 042"
                className="h-10 w-40 bg-card uppercase tabular-nums"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="place-address">Address</Label>
              <Input
                id="place-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={300}
                placeholder="Optional"
                className="h-10 bg-card"
              />
            </div>
            {!isNew && (
              <div className="grid gap-2">
                <Label htmlFor="place-parent">Taluka</Label>
                <NativeSelect id="place-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  {talukaOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="h-9">
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()} className="h-9">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {isNew ? `Add ${noun}` : "Save"}
          </Button>
        </div>
      </form>
    </>
  );
}
