"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const Icon = pending ? Loader2 : LogOut;

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={signOut}
        disabled={pending}
        aria-label="Sign out"
        title="Sign out"
        className="text-muted-foreground hover:text-foreground"
      >
        <Icon className={pending ? "animate-spin" : undefined} />
      </Button>
    );
  }

  return (
    <Button variant="outline" onClick={signOut} disabled={pending}>
      <Icon className={pending ? "animate-spin" : undefined} data-icon="inline-start" />
      Sign out
    </Button>
  );
}
