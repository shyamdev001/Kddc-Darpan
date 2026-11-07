import "server-only";
import { cookies } from "next/headers";
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
 * Asks the API who is logged in, forwarding the browser's session cookie.
 * Returns null when there is no valid session. Reads cookies, so callers
 * must render inside <Suspense>.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user: SessionUser };
  return body.user;
}
