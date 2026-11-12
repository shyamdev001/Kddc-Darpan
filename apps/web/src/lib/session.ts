import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { TwoFactorStatus, UserRole } from "@darpan/shared";

export const SESSION_COOKIE = "darpan_session";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  regionId: string | null;
  branchId: string | null;
}

/**
 * Calls the API from the server, forwarding the browser's session cookie.
 * Returns null on 401 so callers can send the user to /login.
 * Reads cookies, so callers must render inside <Suspense>.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  // The bank requires two-step sign-in for this person and it is not set up yet.
  if (res.status === 403 && ((await res.clone().json().catch(() => null)) as { code?: string } | null)?.code === "2FA_REQUIRED") {
    redirect("/account");
  }
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/** Once per request, however many components ask. */
export const getSession = cache(async (): Promise<{ user: SessionUser; twoFactor: TwoFactorStatus } | null> => {
  return apiGet<{ user: SessionUser; twoFactor: TwoFactorStatus }>("/auth/me");
});

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}
