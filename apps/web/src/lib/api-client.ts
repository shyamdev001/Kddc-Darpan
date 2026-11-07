import { goToSignInExpired } from "./session-expired";

/** Browser-side JSON call to the API (same origin via the Next.js rewrite). Throws with the API's message. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (res.status === 401) {
    goToSignInExpired();
    throw new Error("Your session ended.");
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: string | string[] } | null)?.message;
    throw new Error(Array.isArray(message) ? message[0] : (message ?? `Request failed (error ${res.status}).`));
  }
  return body as T;
}
