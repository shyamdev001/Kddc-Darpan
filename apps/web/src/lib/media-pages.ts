import { MEDIA_PAGE_MAX, MEDIA_PAGE_SIZE, type MediaListResponse } from "@darpan/shared";
import { apiFetch } from "./api-client";

/**
 * The media list comes in pages. Fetches pages until at least `want` items are in hand (or the
 * list ends) and returns them as one list; nextCursor says whether more remain.
 * Pickers pass no `want` and get the whole library.
 */
export async function fetchMediaPages(params: URLSearchParams = new URLSearchParams(), want = Infinity): Promise<MediaListResponse> {
  let result: MediaListResponse | null = null;
  let cursor: string | null = null;
  do {
    const p = new URLSearchParams(params);
    p.set("limit", String(Number.isFinite(want) ? MEDIA_PAGE_SIZE : MEDIA_PAGE_MAX));
    if (cursor) p.set("cursor", cursor);
    const page: MediaListResponse = await apiFetch<MediaListResponse>(`/api/media?${p}`);
    result = result ? { ...page, items: [...result.items, ...page.items] } : page;
    cursor = page.nextCursor;
  } while (cursor && result.items.length < want);
  return result;
}
