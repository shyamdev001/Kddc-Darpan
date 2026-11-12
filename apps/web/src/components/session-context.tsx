"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { canEdit, type UserRole } from "@darpan/shared";

export interface ClientUser {
  id: string;
  name: string;
  role: UserRole;
  /** The bank requires two-step sign-in for this person and it is not on yet. */
  needsTwoFactor: boolean;
}

const SessionContext = createContext<ClientUser | null>(null);

export function SessionProvider({ user, children }: { user: ClientUser; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSessionUser(): ClientUser | null {
  return useContext(SessionContext);
}

/** True for head office roles. Region managers and branch viewers only look. */
export function useCanEdit(): boolean {
  const user = useContext(SessionContext);
  return user ? canEdit(user.role) : false;
}

/** Pages only head office uses; the API refuses them too. */
const EDIT_ONLY = ["/media", "/playlists", "/schedules", "/branches", "/updates"];
const SUPER_ONLY = ["/users", "/activity"];

export function canOpen(pathname: string, role: UserRole): boolean {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  if (SUPER_ONLY.some(under)) return role === "SUPER_ADMIN";
  if (EDIT_ONLY.some(under)) return canEdit(role);
  return true;
}

/** Shows a short note instead of a page the user's role does not include. */
export function AccessCheck({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useContext(SessionContext);
  if (user?.needsTwoFactor && pathname !== "/account") {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">Turn on two-step sign-in to continue.</p>
        <p className="mt-1 text-sm text-muted-foreground">Your account must confirm each sign-in with a code from your phone.</p>
        <Link href="/account" className="mt-4 inline-block text-sm font-medium text-neel hover:underline">
          Set it up now
        </Link>
      </div>
    );
  }
  if (user && pathname && !canOpen(pathname, user.role)) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">This page is for head office.</p>
        <p className="mt-1 text-sm text-muted-foreground">Your account can see screens, proof of play and alerts for your area.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-neel hover:underline">
          Back to overview
        </Link>
      </div>
    );
  }
  return children;
}
