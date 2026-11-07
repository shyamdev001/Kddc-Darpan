import type { MediaItem } from "@darpan/shared";

/** One row in the editor before it is saved. `key` is local only (the same media may appear twice). */
export interface DraftItem {
  key: string;
  media: MediaItem;
  durationSec: number | null;
}

export function effectiveSec(item: DraftItem, defaultImageSec: number): number {
  if (item.media.type === "VIDEO") return item.durationSec ?? item.media.durationSec ?? defaultImageSec;
  return item.durationSec ?? defaultImageSec;
}

export type ItemIssue = "failed" | "processing" | "ended" | "upcoming" | null;

/** Why a screen would skip this item right now (mirrors what the TV manifest will do). */
export function issueOf(media: MediaItem, now = Date.now()): ItemIssue {
  if (media.status === "FAILED") return "failed";
  if (media.status !== "READY") return "processing";
  if (media.endDate && Date.parse(media.endDate) < now) return "ended";
  if (media.startDate && Date.parse(media.startDate) > now) return "upcoming";
  return null;
}

export function newKey(): string {
  return crypto.randomUUID();
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
