import type { KioskState } from './screen';

/** TV app updates. Upload an APK, offer it to test screens, then to every screen. */
export const RELEASE_STAGES = ['TEST', 'ALL', 'STOPPED'] as const;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];

/** The only app the server accepts as an update. */
export const TV_APP_PACKAGE = 'in.kdcc.darpan';
export const MAX_APK_BYTES = 100 * 1024 * 1024;

export interface AppReleaseEntry {
  id: string;
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  stage: ReleaseStage;
  createdAt: string;
  uploadedBy: string | null;
  /** Screens that last reported running this version. */
  screensOnIt: number;
}

export interface UpdateScreenEntry {
  id: string;
  name: string;
  branch: string | null;
  online: boolean;
  testUpdates: boolean;
  appVersion: string | null;
  appVersionCode: number | null;
  kiosk: KioskState | null;
  /** The TV's last report on an update, e.g. "Failed: ..."; null when there is nothing to say. */
  updateStatus: string | null;
}

/** GET /api/releases */
export interface ReleasesResponse {
  releases: AppReleaseEntry[];
  screens: UpdateScreenEntry[];
}

/** PATCH /api/releases/:id */
export interface UpdateReleaseRequest {
  stage?: ReleaseStage;
  notes?: string | null;
}

/** PUT /api/releases/test-screens */
export interface SetTestScreensRequest {
  screenIds: string[];
}
