import type { DisplayHoursValue, TimeSlot } from './schedule';
import type { NightMode, PlaySyncReport, TvCapabilities, TvNetworkType } from './device-protocol';
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
  /**
   * Set while the screen still counts as online (it has 3 minutes from its last heartbeat) but its
   * live connection is already gone: the app was closed, the TV switched off or the network dropped.
   * When it was lost; the last heartbeat when the server restarted since.
   */
  connectionLostAt: string | null;
  lastSeenAt: string | null;
  orientation: Orientation;
  branch: BranchRef | null;
  playlist: ScreenPlaylistRef | null;
  model: string | null;
  appVersion: string | null;
  nowPlaying: { id: string; displayName: string } | null;
}

/** How many screens said yes, no, or have not said (app too old, or never tried). */
export interface FleetTally {
  yes: number;
  no: number;
  unknown: number;
}

/** A group of screens sharing one value (an Android version, a model...), most common first. */
export interface FleetGroup {
  label: string;
  screens: number;
  online: number;
}

export interface FleetScreenRef {
  id: string;
  name: string;
  branch: string | null;
  /** what is wrong, in plain words */
  note: string;
}

/**
 * What the screens in the user's area are, and what they can do (docs/AUDIT.md, DC6): the answer
 * to "can we raise the Android minimum?" and "which TVs cannot play our videos?" in one place.
 */
export interface FleetSummary {
  screens: number;
  /** screens whose app has sent the full report (make, decoders...) */
  reported: number;
  android: FleetGroup[];
  /** lowest Android API level any screen reports; null when none has */
  lowestSdk: number | null;
  /** screens that have never said which Android they run */
  androidUnknown: number;
  models: FleetGroup[];
  platforms: FleetGroup[];
  appVersions: FleetGroup[];
  videos: FleetTally;
  portraitVideos: FleetTally;
  youtube: FleetTally;
  kiosk: FleetTally;
  brightness: FleetTally;
  screenOff: FleetTally;
  /** screens that need a look: cannot play our videos, or skip some */
  attention: FleetScreenRef[];
}

/** screen: the panel went dark (the TV's sleep or auto power-off). input: another input or app took it. */
export type TvOffKind = 'screen' | 'input';

export interface TvOffReport {
  kind: TvOffKind;
  at: string;
  /** when the app was on screen again; null while still away */
  backAt: string | null;
  /** how many times in the day before the report */
  count: number;
}

export interface ScreenListResponse {
  items: ScreenSummary[];
  /** TVs showing a pairing code that nobody has claimed yet */
  waitingToPair: number;
}

/**
 * off: the app is not the TV's device owner (kiosk mode not set up). locked: pinned, nothing else
 * can open. maintenance: unlocked for a while so the TV's settings can be used. exited: taken out
 * of kiosk mode from the dashboard until it is locked again.
 */
export const KIOSK_STATES = ['off', 'locked', 'maintenance', 'exited'] as const;
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
  /** Still crashing in safe mode: only the default slide for now; it keeps syncing and takes updates. */
  rescueMode: boolean;
  /** The TV holds the kiosk PIN; null for app versions that do not report it. */
  kioskPinSet: boolean | null;
  /** Videos this TV skips because it cannot play them, with the ad's name and the reason in plain words. */
  unplayable: { mediaId: string; name: string; reason: string }[];
  /** The TV itself took the screen away during display hours, not Darpan; null when not in the last week. */
  tvOff: TvOffReport | null;
  /** What the TV says it can do; null for app versions that do not report it. */
  capabilities: TvCapabilities | null;
  /** Screen on/off, uptime, network, temperature, volume...; null for app versions that do not report it. */
  tvStatus: TvStatusReport | null;
  /** How the TV keeps to the shared timeline; null for app versions that do not report it. */
  playSync: PlaySyncReport | null;
  /** Its branch keeps screens in step. */
  syncPlayback: boolean;
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

/** `POST /api/screens/:id/replace`: the code a factory-reset or swapped TV shows. */
export interface ReplaceScreenRequest {
  pairingCode: string;
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
export const REMOTE_COMMANDS = ['reload', 'restart', 'clearCache', 'screenshot', 'kioskUnlock', 'kioskLock', 'screenOffTest', 'reboot', 'mute', 'unmute', 'volume'] as const;
export type RemoteCommandType = (typeof REMOTE_COMMANDS)[number];

/** POST /api/screens/:id/commands */
export interface SendCommandRequest {
  type: RemoteCommandType;
  /** For "volume" only: 0 to 100. */
  level?: number;
}

/**
 * Why [type] cannot work on this TV, from what it last reported; null = it may (the TV still has
 * the last word). Used by the server to refuse and by the dashboard to grey the button out.
 * The reboot and volume capabilities arrived in the same app version, so a missing `reboot` means
 * an app too old for any of the four new commands.
 */
export function commandUnsupported(type: string, caps: TvCapabilities | null): string | null {
  const tooOld = 'Update the TV app first: this version does not know this command.';
  switch (type) {
    case 'screenOffTest':
      return caps && !caps.deviceOwner ? 'Kiosk mode is not set up on this TV: the app cannot switch the screen off.' : null;
    case 'reboot':
      if (!caps || caps.reboot === null || caps.reboot === undefined) return tooOld;
      if (!caps.deviceOwner) return 'Kiosk mode is not set up on this TV: the app cannot restart it.';
      if (caps.sdk < 24) return 'Restarting the TV from the app needs Android 7 or newer.';
      return caps.reboot ? null : 'This TV model refused a restart from the app. Use its power button.';
    case 'mute':
    case 'unmute':
    case 'volume':
      if (!caps || caps.reboot === null || caps.reboot === undefined) return tooOld;
      return caps.volume === false ? 'This TV sets its volume itself; Android cannot change it. Use the TV remote.' : null;
    default:
      return null;
  }
}

/** The TV's own state, from its heartbeat (TV control E). null fields: this model does not say. */
export interface TvStatusReport {
  screenOn: boolean | null;
  /** When the TV last started, by the server's clock. */
  bootedAt: string | null;
  ip: string | null;
  networkType: TvNetworkType | null;
  /** Android's thermal status (Android 10+): none, light, moderate, severe, critical, emergency, shutdown. */
  thermal: string | null;
  /** Why Android last started, where the firmware says (e.g. "reboot", "cold_boot", "watchdog"). */
  bootReason: string | null;
  /** Why the app's previous run ended (Android 11+), e.g. "crash", "lowMemory", "signaled". */
  lastExit: { reason: string; at: string } | null;
  /** Media volume in percent. */
  volume: number | null;
  muted: boolean | null;
  /** Outside display hours: black at the lowest backlight, or the panel off. null in hours. */
  nightMode: NightMode | null;
  reportedAt: string;
}

/**
 * Taking a TV out of kiosk mode (K7). exit: unlocked until "Lock now"; removeOwner: also no longer
 * device owner, so it can be uninstalled, and only adb at the TV makes it a kiosk again.
 * Super admin only, with a fresh two-step code, the screen's name typed and a reason.
 */
export const KIOSK_RELEASE_ACTIONS = ['exit', 'removeOwner'] as const;
export type KioskReleaseAction = (typeof KIOSK_RELEASE_ACTIONS)[number];

/** POST /api/screens/:id/kiosk-release */
export interface KioskReleaseRequest {
  action: KioskReleaseAction;
  /** A code from the authenticator app (or a recovery code), checked now, not at sign-in. */
  code: string;
  /** The screen's name as shown, to make sure it is the right TV. */
  confirmName: string;
  /** Why; kept in the activity log. */
  reason: string;
}

/** GET /api/kiosk/pin */
export interface KioskPinStatus {
  set: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** PUT /api/kiosk/pin. pin null removes it (TVs go back to the offline-only Menu unlock). */
export interface SetKioskPinRequest {
  pin: string | null;
  /** A fresh two-step code. */
  code: string;
}

/** 6 to 12 digits: TV remotes and the on-screen keyboard both handle digits. */
export const KIOSK_PIN_PATTERN = /^\d{6,12}$/;

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
/** The screen-off test waits for the TV to wake by itself, and gives up after about 7 minutes. */
export const SCREEN_OFF_TEST_REPLY_SEC = 480;
export const commandReplySec = (type: string): number => (type === 'screenOffTest' ? SCREEN_OFF_TEST_REPLY_SEC : COMMAND_REPLY_SEC);
