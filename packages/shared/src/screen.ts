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

/** The TV's downloads, as last reported; null for app versions that do not report them. */
export interface ScreenFiles {
  ready: number;
  total: number;
  /** Why the last file failed, in plain words; null when nothing failed. */
  error: string | null;
}

/** "3 of 12 files missing: storage full", or null when nothing is missing. */
export function filesProblem(files: ScreenFiles | null): string | null {
  if (!files) return null;
  const missing = files.total - files.ready;
  if (missing <= 0) return null;
  const what = `${missing} of ${files.total} file${files.total === 1 ? '' : 's'} missing`;
  return files.error ? `${what}: ${files.error}` : `${what} (still downloading)`;
}

// ---- Live wall: what every screen shows right now ----

/** One tile on the Live wall. TVs report each new item as it comes on, so this is seconds old. */
export interface LiveScreen {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  orientation: Orientation;
  branch: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
  /** The poster or video on screen (null while offline, idle or showing a broadcast). */
  nowPlaying: { id: string; displayName: string; type: 'IMAGE' | 'VIDEO' } | null;
  /** A broadcast this TV says it is showing, while that broadcast is still running. */
  broadcast: {
    id: string;
    kind: 'MESSAGE' | 'MEDIA' | 'LINK';
    title: string | null;
    message: string | null;
    mediaId: string | null;
    youtubeId: string | null;
    /** "playing", "loading" or "error: ..." as the TV reports it. */
    status: string | null;
  } | null;
  files: ScreenFiles | null;
  /** Crash-looping: the TV plays posters only for now. */
  safeMode: boolean;
}

export interface LiveWallResponse {
  items: LiveScreen[];
  /** Server time of this snapshot. */
  at: string;
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
  /** Android debugging (adb) is on, as the TV last reported; null for app versions that do not report it. */
  adbEnabled: boolean | null;
  files: ScreenFiles | null;
  /** The app's last crash, as the TV reported it; null when it never crashed (or is too old to say). */
  crash: { at: string; type: string; message: string | null; frames: string[]; total: number; recent: number } | null;
  /** Many crashes lately: playing posters only (no video, no live links) for up to an hour. */
  safeMode: boolean;
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

/**
 * A screen counts as online while its TV holds the live connection (status ONLINE) and was heard
 * from within this window. The window only matters if the server missed a disconnect.
 */
export const ONLINE_WINDOW_MS = 3 * 60_000;

/**
 * Live updates for the dashboard: Socket.IO at this path (under /api, so the same proxy rules reach
 * it), namespace `/dashboard`, signed in by the session cookie. The server only says *which* screens
 * changed; the page then reloads its data through the normal API, so each user still sees only their area.
 */
export const DASHBOARD_SOCKET_PATH = '/api/realtime';
export const DASHBOARD_NAMESPACE = '/dashboard';
export const SCREENS_CHANGED_EVENT = 'screens:changed';
export interface ScreensChangedPayload {
  screenIds: string[];
}
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
