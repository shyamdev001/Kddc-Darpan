import type { DisplayHoursValue, TimeSlot } from './schedule';
// Dashboard view of screens (TVs). Device-side shapes live in device-protocol.ts.
import type { Orientation } from './enums';

/** Which level of the hierarchy the screen's playlist comes from. */
export type PlaylistSource = 'SCREEN' | 'BRANCH' | 'TALUKA' | 'REGION' | 'ALL';

export interface ScreenPlaylistRef {
  id: string;
  name: string;
  source: PlaylistSource;
}

export interface BranchRef {
  id: string;
  name: string;
  code: string | null;
}

export interface ScreenSummary {
  id: string;
  name: string;
  /** false when the TV was reset and must be paired again */
  paired: boolean;
  online: boolean;
  lastSeenAt: string | null;
  orientation: Orientation;
  branch: BranchRef | null;
  playlist: ScreenPlaylistRef | null;
  model: string | null;
  appVersion: string | null;
  nowPlaying: { id: string; displayName: string } | null;
}

export interface ScreenListResponse {
  items: ScreenSummary[];
  /** TVs showing a pairing code that nobody has claimed yet */
  waitingToPair: number;
}

export interface ScreenDetail extends ScreenSummary {
  osVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  storageFreeMb: number | null;
  storageTotalMb: number | null;
  ramFreeMb: number | null;
  ramTotalMb: number | null;
  manifestVersion: string | null;
  pairedAt: string | null;
  createdAt: string;
  /** playlist set directly on this screen (null = inherits from branch/taluka/region/all) */
  ownPlaylistId: string | null;
  /** what the screen plays when it has no playlist of its own (from branch, taluka, region or all) */
  fallbackPlaylist: ScreenPlaylistRef | null;
  /** Timed playlists that can take over at certain times, most important first. */
  scheduled: (ScreenPlaylistRef & { slots: TimeSlot[] })[];
  /** When the screen is on, and which level set it; null = always on. */
  hours: { hours: DisplayHoursValue; source: PlaylistSource } | null;
}

export interface ClaimScreenRequest {
  pairingCode: string;
  name: string;
  branchId: string;
  orientation?: Orientation;
  playlistId?: string | null;
}

export interface UpdateScreenRequest {
  name?: string;
  branchId?: string;
  orientation?: Orientation;
}

export interface SetScreenPlaylistRequest {
  playlistId: string | null;
}

export interface BranchOption extends BranchRef {
  taluka: string;
  region: string;
}

/** A screen counts as online if it was heard from within this window. */
export const ONLINE_WINDOW_MS = 3 * 60_000;
export const PAIRING_CODE_TTL_MS = 30 * 60_000;
