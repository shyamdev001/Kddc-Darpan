/** Proof-of-play report: GET /api/reports/plays?from=YYYY-MM-DD&to=YYYY-MM-DD[&branchId][&screenId][&mediaId] */

/** Most days one report may cover. */
export const MAX_REPORT_DAYS = 366;
/** Most entries a TV may send in one POST /api/devices/playlogs. */
export const MAX_PLAYLOG_BATCH = 1000;
/** Raw play logs are kept this long; daily totals are kept for good. */
export const PLAYLOG_KEEP_DAYS = 90;

export interface PlayTotals {
  plays: number;
  durationMs: number;
}

export interface PlayReportMedia extends PlayTotals {
  /** Null when the ad has since been deleted. */
  mediaId: string | null;
  name: string;
  screens: number;
}

export interface PlayReportScreen extends PlayTotals {
  /** Null when the screen has since been removed. */
  screenId: string | null;
  name: string;
  branch: string | null;
  ads: number;
}

export interface PlayReportDay extends PlayTotals {
  day: string; // YYYY-MM-DD, India date
}

export interface PlayReport {
  from: string;
  to: string;
  totals: PlayTotals & { screens: number; ads: number };
  byMedia: PlayReportMedia[];
  byScreen: PlayReportScreen[];
  byDay: PlayReportDay[];
}
