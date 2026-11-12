"use client";

import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH } from "@darpan/shared";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset(o: boolean) {
    setOpen(o);
    if (!o) {
      setCurrent("");
      setNext("");
      setAgain("");
      setError(null);
      setDone(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) {
      setError("The two new passwords are different");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setPending(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Change password"
        title="Change password"
        className="text-muted-foreground hover:text-foreground"
      >
        <KeyRound />
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <div>
            <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Change password</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Other devices signed in to your account are signed out.
            </DialogDescription>
          </div>
          {done ? (
            <div className="grid gap-4">
              <p role="status" className="rounded-md bg-ok/10 px-3 py-2 text-sm text-[#1b5e33]">
                Password changed. Use the new one next time you sign in.
              </p>
              <div className="flex justify-end">
                <Button onClick={() => reset(false)} className="h-10 px-4">
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pw-current">Current password</Label>
                <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pw-new">New password</Label>
                <Input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                />
                <p className="text-sm text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters. A few words together is easy to remember.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pw-again">New password again</Label>
                <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => reset(false)} className="h-10 px-4">
                  Cancel
                </Button>
                <Button type="submit" disabled={pending} className="h-10 px-4">
                  {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  Change password
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
