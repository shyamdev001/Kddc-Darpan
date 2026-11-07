"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Only allow redirects back into this app (never to another site).
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("expired") ? "Your session ended. Sign in again to continue." : null,
  );
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.replace(safeNext(params.get("next")));
        router.refresh();
        return;
      }
      if (res.status === 429) setError("Too many attempts from this computer. Wait one minute, then try again.");
      else if (res.status === 401) setError("That email and password don't match an account. Check the spelling of the email.");
      else if (res.status === 400) setError("Enter a full email address, like name@kdcc.local.");
      else setError("Sign-in failed on the server. Try again in a moment.");
    } catch {
      setError("Can't reach the Darpan server. Check that the API is running.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          autoFocus
          required
          aria-invalid={error ? true : undefined}
          className="h-11 bg-card px-3 text-[15px]"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            onKeyUp={trackCaps}
            onKeyDown={trackCaps}
            aria-invalid={error ? true : undefined}
            aria-describedby={capsLock ? "caps-hint" : undefined}
            className="h-11 bg-card pr-11 pl-3 text-[15px]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {capsLock && (
          <p id="caps-hint" className="text-sm text-[#8a5a00]">
            Caps Lock is on.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 h-11 w-full text-[15px]">
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
