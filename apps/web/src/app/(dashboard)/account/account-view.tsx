"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ROLE_LABELS,
  type TwoFactorEnableResponse,
  type TwoFactorSetupResponse,
  type TwoFactorStatus,
  type UserRole,
} from "@darpan/shared";
import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

interface Props {
  user: { name: string; email: string; role: UserRole };
  initial: TwoFactorStatus;
}

export function AccountView({ user, initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-card px-4 py-4 sm:px-5">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="min-w-0 break-words">{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 break-words">{user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{ROLE_LABELS[user.role] ?? user.role}</dd>
        </dl>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-5">
          {status.enabled ? (
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          ) : (
            <ShieldOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Two-step sign-in {status.enabled ? "is on" : "is off"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {status.enabled
                ? `Each sign-in asks for a code from your phone. ${status.recoveryCodesLeft} of 8 recovery codes left.`
                : "After your password, sign-in also asks for a 6-digit code from an app on your phone, so a stolen password alone is not enough."}
            </p>
            {!status.enabled && status.required && (
              <p className="mt-2 rounded-md bg-haldi/15 px-3 py-2 text-sm text-[#6b4a00]">
                Your account must have this on before you can use the rest of the dashboard.
              </p>
            )}
          </div>
        </div>

        <div className="px-4 py-5 sm:px-5">
          {codes ? (
            <RecoveryCodes
              codes={codes}
              onDone={() => {
                setCodes(null);
                router.refresh();
              }}
            />
          ) : status.enabled ? (
            <TurnOff
              onDone={(s) => {
                setStatus(s);
                router.refresh();
              }}
            />
          ) : setup ? (
            <Confirm
              setup={setup}
              onCancel={() => setSetup(null)}
              onDone={(res) => {
                setSetup(null);
                setStatus(res.status);
                setCodes(res.recoveryCodes);
              }}
            />
          ) : (
            <Start onReady={setSetup} />
          )}
        </div>
      </section>
    </div>
  );
}

function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
      {text}
    </p>
  );
}

function Start({ onReady }: { onReady: (s: TwoFactorSetupResponse) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setPending(true);
    setError(null);
    try {
      onReady(await apiFetch<TwoFactorSetupResponse>("/api/auth/2fa/setup", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-[15px]">
        You need an authenticator app on your phone: Google Authenticator or Microsoft Authenticator both work, and are free.
      </p>
      <ErrorNote text={error} />
      <div>
        <Button onClick={begin} disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Set up two-step sign-in
        </Button>
      </div>
    </div>
  );
}

function Confirm({
  setup,
  onCancel,
  onDone,
}: {
  setup: TwoFactorSetupResponse;
  onCancel: () => void;
  onDone: (r: TwoFactorEnableResponse) => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      onDone(await apiFetch<TwoFactorEnableResponse>("/api/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code: code.trim() }) }));
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-[13rem_1fr]">
      <div className="grid content-start gap-2">
        {/* The SVG is drawn by our own API from the otpauth link, not from user input. */}
        <div
          className="aspect-square w-52 rounded-lg border bg-white p-2 [&>svg]:size-full"
          role="img"
          aria-label="QR code to scan with your authenticator app"
          dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
        />
      </div>
      <form onSubmit={submit} className="grid content-start gap-4">
        <ol className="grid list-decimal gap-2 pl-5 text-[15px]">
          <li>In the app, add an account and scan this QR code.</li>
          <li>
            Can&apos;t scan? Choose to enter a key and type:
            <code className="mt-1 block w-fit rounded bg-mist px-2 py-1 font-mono text-sm tracking-wide break-all select-all">
              {setup.secret}
            </code>
          </li>
          <li>Enter the 6-digit code the app shows for KDCC Darpan.</li>
        </ol>
        <div className="grid max-w-56 gap-1.5">
          <Label htmlFor="enable-code">Code from the app</Label>
          <Input
            id="enable-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
            autoFocus
            className="h-11 text-[17px] tracking-[0.2em] tabular-nums"
          />
        </div>
        <ErrorNote text={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || code.replace(/\s/g, "").length !== 6} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Turn on
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="h-10 px-4">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `KDCC Darpan recovery codes\nEach code works once, instead of the code from your phone.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kdcc-darpan-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="font-semibold">Save these recovery codes</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          If you lose your phone, each code lets you sign in once. They are shown only now. Print them or keep them somewhere safe, not on the
          same phone.
        </p>
      </div>
      <ul className="grid w-fit grid-cols-2 gap-x-8 gap-y-1.5 rounded-lg bg-mist px-5 py-4 font-mono text-[15px] tracking-wide">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy} className="h-10 px-4">
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" onClick={download} className="h-10 px-4">
          <Download data-icon="inline-start" />
          Download
        </Button>
        <Button onClick={onDone} className="h-10 px-4">
          I have saved them
        </Button>
      </div>
    </div>
  );
}

function TurnOff({ onDone }: { onDone: (s: TwoFactorStatus) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Moving to a new phone? Turn it off, then set it up again on the new phone. Lost your phone and your recovery codes? Ask a super
          admin to turn it off from the Users page.
        </p>
        <div>
          <Button variant="outline" onClick={() => setOpen(true)} className="h-10 px-4">
            Turn off two-step sign-in
          </Button>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      onDone(await apiFetch<TwoFactorStatus>("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code: code.trim() }) }));
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="off-password">Your password</Label>
        <Input
          id="off-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="off-code">Code from your phone, or a recovery code</Label>
        <Input
          id="off-code"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={12}
          className="h-10 tracking-[0.15em]"
        />
      </div>
      <ErrorNote text={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending || !password || !code.trim()} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Turn off
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="h-10 px-4">
          Cancel
        </Button>
      </div>
    </form>
  );
}
