"use client";

import { useEffect, useState } from "react";
import { KIOSK_PIN_PATTERN, type KioskPinStatus } from "@darpan/shared";
import { KeyRound, Loader2 } from "lucide-react";
import { useSessionUser } from "@/components/session-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { formatAgo } from "@/lib/format";

/**
 * The PIN for the local unlock on a locked TV: Menu five times on the remote, then the PIN, opens
 * the TV's settings for maintenance, also with no network. Every TV gets it (as a salted hash) at its
 * next sync. Super admins set it, with a code from their two-step app.
 */
export function KioskPinCard() {
  const me = useSessionUser();
  const [status, setStatus] = useState<KioskPinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    apiFetch<KioskPinStatus>("/api/kiosk/pin")
      .then((s) => {
        setStatus(s);
        setNow(Date.now());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const superAdmin = me?.role === "SUPER_ADMIN";

  async function save(remove: boolean) {
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const s = await apiFetch<KioskPinStatus>("/api/kiosk/pin", { method: "PUT", body: JSON.stringify({ pin: remove ? null : pin, code }) });
      setStatus(s);
      setNow(Date.now());
      setPin("");
      setCode("");
      setDone(remove ? "PIN removed. The TVs drop it at their next sync." : "PIN saved. The TVs get it at their next sync, within a few minutes.");
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }

  const pinOk = KIOSK_PIN_PATTERN.test(pin);
  const codeOk = /^\S{6,40}$/.test(code);

  return (
    <section className="mt-6 rounded-xl border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Kiosk unlock PIN</h2>
        <p className="text-sm text-muted-foreground">
          At a locked TV, press Menu five times quickly and enter this PIN to open the TV&apos;s settings for maintenance. It
          works without a network. Five wrong tries block it for 15 minutes; every unlock shows in the activity log.
        </p>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <p className="text-sm">
          {status === null ? (
            "Loading…"
          ) : status.set ? (
            <>
              <span className="font-medium">A PIN is set</span>
              <span className="text-muted-foreground">
                {status.updatedAt ? `, ${formatAgo(status.updatedAt, now)}` : ""}
                {status.updatedBy ? ` by ${status.updatedBy}` : ""}.
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">No PIN is set.</span>{" "}
              <span className="text-muted-foreground">A locked TV can then only be unlocked from here, or with Menu while it has no network.</span>
            </>
          )}
        </p>

        {superAdmin ? (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (pinOk && codeOk) void save(false);
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="kiosk-pin">New PIN, 6 to 12 digits</Label>
              <Input
                id="kiosk-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kiosk-pin-code">Code from your two-step app</Label>
              <Input id="kiosk-pin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={40} value={code} onChange={(e) => setCode(e.target.value.trim())} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || !pinOk || !codeOk} className="h-10">
                {saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
                {status?.set ? "Change PIN" : "Set PIN"}
              </Button>
              {status?.set && (
                <Button type="button" variant="outline" disabled={saving || !codeOk} onClick={() => void save(true)} className="h-10 text-destructive hover:text-destructive">
                  Remove
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only a super admin can set or change the PIN.</p>
        )}

        {done && <p role="status" className="text-sm text-[#1b7f3b]">{done}</p>}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
