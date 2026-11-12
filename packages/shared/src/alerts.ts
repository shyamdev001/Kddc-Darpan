import type { DisplayHoursValue } from './schedule';

/** How long a TV must be silent before it counts as offline. */
export const OFFLINE_AFTER_CHOICES = [5, 10, 15, 30, 60] as const;
export const MAX_ALERT_RECIPIENTS = 20;

export interface AlertSettingsValue {
  enabled: boolean;
  offlineAfterMin: number;
  /** Email addresses that get the alert digest. */
  recipients: string[];
  /** For screens without display hours: only alert inside this window (India time). */
  window: DisplayHoursValue;
}

export interface AlertEntry {
  id: string;
  screen: { id: string; name: string };
  branch: string | null;
  offlineSince: string;
  /** null while the screen is offline outside the hours it should be on (no email yet). */
  notifiedAt: string | null;
  resolvedAt: string | null;
}

/** GET /api/alerts */
export interface AlertsResponse {
  open: AlertEntry[];
  /** Back online in the last 7 days, newest first. */
  recent: AlertEntry[];
  settings: AlertSettingsValue;
  /** "console": emails are only written to the server log (development). */
  mailDriver: 'console' | 'smtp';
}

/** PUT /api/alerts/settings */
export type UpdateAlertSettingsRequest = AlertSettingsValue;
