import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { UserRole } from "@darpan/shared";

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
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/** Once per request, however many components ask. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const body = await apiGet<{ user: SessionUser }>("/auth/me");
  return body?.user ?? null;
});
