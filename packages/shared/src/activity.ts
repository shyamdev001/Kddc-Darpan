/** Rows per page on the Activity page. */
export const ACTIVITY_PAGE_SIZE = 50;
/** Most rows in one CSV export. */
export const ACTIVITY_EXPORT_MAX = 20_000;

export interface ActivityEntry {
  id: string;
  at: string;
  user: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  /** Pass as `before` to get the next (older) page; null when there is no more. */
  next: string | null;
  /** For the filters. */
  users: { id: string; name: string }[];
  areas: string[];
}
