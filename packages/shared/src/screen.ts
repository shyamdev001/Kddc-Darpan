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

/**
 * off: the app is not the TV's device owner (kiosk mode not set up). locked: pinned, nothing else
 * can open. maintenance: unlocked for a while so the TV's settings can be used.
 */
export const KIOSK_STATES = ['off', 'locked', 'maintenance'] as const;
export type KioskState = (typeof KIOSK_STATES)[number];
/** How long "Unlock for maintenance" lasts; the TV locks itself again after this. */
export const KIOSK_MAINTENANCE_MIN = 15;

export interface ScreenDetail extends ScreenSummary {
  osVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  storageFreeMb: number | null;
  storageTotalMb: number | null;
  ramFreeMb: number | null;
  ramTotalMb: number | null;
  manifestVersion: string | null;
  /** Kiosk mode as the TV last reported it; null for app versions before kiosk mode. */
  kiosk: KioskState | null;
  /** While in maintenance: when the TV locks itself again. */
  kioskUntil: string | null;
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

/** Commands the dashboard can send to one TV. */
export const REMOTE_COMMANDS = ['reload', 'restart', 'clearCache', 'screenshot', 'kioskUnlock', 'kioskLock'] as const;
export type RemoteCommandType = (typeof REMOTE_COMMANDS)[number];

/** POST /api/screens/:id/commands */
export interface SendCommandRequest {
  type: RemoteCommandType;
}

/**
 * A command and what became of it. SENT with no reply after COMMAND_REPLY_SEC is shown as
 * "no reply" (the TV went offline or runs an app version without this command).
 */
export interface ScreenCommandEntry {
  id: string;
  type: string;
  status: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  issuedBy: string | null;
  error: string | null;
  /** For a finished screenshot: where to load the image. */
  screenshotUrl: string | null;
}

export const COMMAND_REPLY_SEC = 90;
