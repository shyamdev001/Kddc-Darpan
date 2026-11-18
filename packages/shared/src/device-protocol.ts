import type { ManifestBroadcast } from './broadcast';
import type { DisplayHoursValue, TimeSlot } from './schedule';
// Contract between the API and the Android TV app.
// The Kotlin side mirrors these shapes with kotlinx.serialization.
import type { MediaType } from './enums';

/** POST /api/devices/register */
export interface RegisterDeviceRequest {
  hardwareId: string;
  model: string;
  osVersion: string;
  resolution: string; // e.g. "1920x1080"
  appVersion?: string;
}

export interface RegisterDeviceResponse {
  deviceId: string;
  deviceToken: string; // shown once; server stores only a hash
  pairingCode: string; // 6 digits, displayed on the TV
  pairingExpiresAt: string; // ISO 8601; GET /api/devices/status issues a fresh code after this
}

/** GET /api/devices/status (Bearer deviceToken). The TV polls this while showing the code. */
export interface DeviceStatusResponse {
  paired: boolean;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  screenName: string | null;
}

/** GET /api/devices/manifest */
export interface ManifestItem {
  mediaId: string;
  url: string;
  sha256: string;
  size: number;
  type: MediaType;
  /** Default length; playlists may override it per item. */
  durationSec: number;
  /** ad start/end (ISO 8601 UTC); the TV skips the item outside this window, even offline */
  validFrom: string | null;
  validUntil: string | null;
}

/** One playlist the TV may play, with the times it plays. */
export interface ManifestPlaylist {
  id: string;
  name: string;
  /** Empty = always. */
  slots: TimeSlot[];
  /** Play order; each mediaId is in Manifest.items. */
  items: { mediaId: string; durationSec: number }[];
}

export interface ManifestSettings {
  orientation: 'LANDSCAPE' | 'PORTRAIT';
  /** When the screen is on (Asia/Kolkata). null = always on. */
  hours: DisplayHoursValue | null;
  /** Keep to the shared timeline, in step with the other TVs (set per branch). */
  sync?: boolean;
}

/** How a TV keeps to the shared timeline, sent in each heartbeat. */
export interface PlaySyncReport {
  /** synced: on the shared timeline; free: its own loop (sync off for its branch). */
  mode: 'synced' | 'free';
  /** How far the TV's idea of the server time can be off (half the quickest round trip); null before the first answer. */
  offsetErrorMs: number | null;
  /** The playing video's distance from the timeline (positive = ahead); null when no video is playing. */
  driftMs: number | null;
  /** False after a power cut with no internet: the TV does not know the time yet. */
  clockCertain: boolean;
}

export interface Manifest {
  version: string; // changes whenever content changes
  generatedAt: string; // ISO 8601 UTC
  /** Every file the TV needs (download, verify, keep). */
  items: ManifestItem[];
  /**
   * Most important first. At any moment the TV plays the first playlist whose slots match the
   * local time; a playlist with no slots always matches, so nothing after it is listed.
   */
  playlists: ManifestPlaylist[];
  settings: ManifestSettings;
  /** Newer TV app to install, if one is offered to this screen; TVs on that version or newer ignore it. */
  app?: ManifestApp | null;
  /** Shown instead of the playlists (even outside display hours) until it ends. */
  broadcast?: ManifestBroadcast | null;
  /**
   * The default slide (its file is first in `items`): shown whenever nothing else can play, so a
   * screen is never black or technical during display hours. Its dates are ignored.
   */
  fallbackMediaId?: string | null;
}

/** A TV app build (APK) in the manifest. Download with the device token, check sha256, install. */
export interface ManifestApp {
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  size: number;
}

/** Socket.IO namespace `/devices`. Connect with `auth: { token: deviceToken }`. */
export const DEVICE_NAMESPACE = '/devices';

export interface HeartbeatPayload {
  currentMediaId: string | null;
  storageFreeBytes: number;
  ramFreeBytes: number;
  appVersion: string;
  storageTotalBytes?: number;
  ramTotalBytes?: number;
  /** manifest version the TV is playing, so the dashboard can tell when it is up to date */
  manifestVersion?: string;
  /** Kiosk mode: 'off' | 'locked' | 'maintenance' (see KIOSK_STATES) */
  kiosk?: string;
  /** ISO time maintenance ends, or null */
  kioskUntil?: string | null;
  /** Android versionCode of the running app */
  appVersionCode?: number;
  /** Last word on an app update ("Downloading 0.1.9", "Failed: ..."); null when idle */
  updateStatus?: string | null;
  /** The broadcast on screen and how it is going ('playing', 'loading', 'error: ...'); null when none. */
  broadcastId?: string | null;
  broadcastStatus?: string | null;
  /** Android debugging (adb) switched on. Anyone on the branch network could then control the TV. */
  adbEnabled?: boolean;
  /** Files of the newest manifest that are downloaded and verified, out of how many. */
  filesReady?: number;
  filesTotal?: number;
  /** Why the last file failed ("storage full: needs 240 MB, 120 MB free"); null when all is well. */
  downloadError?: string | null;
  /** The last crash (null: never crashed). */
  crash?: CrashReportPayload | null;
  /** Many crashes lately: playing posters only (no video, no live links) for a while. */
  safeMode?: boolean;
  /** What this TV model can do, detected on the TV at each start. */
  capabilities?: TvCapabilities;
  sync?: PlaySyncReport;
}

/**
 * The oldest WebView (Chromium) major version YouTube's embedded player is expected to work on.
 * Conservative: older ones often load the page but never start the video.
 */
export const YOUTUBE_MIN_WEBVIEW = 80;

/** What a TV can and cannot do. Behaviour differs per model, so the TV checks itself. null = not known yet. */
export interface TvCapabilities {
  /** Android API level, e.g. 28 = Android 9. */
  sdk: number;
  /** The system WebView: YouTube broadcasts play in it. null = none installed. */
  webView: { package: string; version: string; major: number | null } | null;
  /** Has a hardware decoder for the 1080p H.264 videos the server makes. */
  h264_1080p: boolean | null;
  /** Has an HEVC (H.265) decoder (for the record; the server always makes H.264). */
  hevc: boolean | null;
  /** The app is device owner: kiosk mode, system brightness, auto-start and screen-off work. */
  deviceOwner: boolean;
  /** System brightness read back after the dashboard set it: true = honoured, false = ignored. */
  brightness: boolean | null;
  network: { type: 'ethernet' | 'wifi' | 'other' | 'none'; wifiDbm: number | null };
  /** Outside display hours the app could switch the panel off (and back on). */
  screenOff: boolean | null;
  /** Screenshots show video; false = the video area comes out black on this model. */
  videoInScreenshot: boolean | null;
}

/** Whether a YouTube broadcast should play on this TV, and why not. */
export function youtubeSupport(c: TvCapabilities | null): { ok: boolean | null; reason: string | null } {
  if (!c) return { ok: null, reason: 'has not reported what it can do yet (app too old or never connected)' };
  if (!c.webView) return { ok: false, reason: 'has no WebView, which YouTube needs' };
  if (c.webView.major === null) return { ok: null, reason: `has WebView ${c.webView.version}, version unknown` };
  if (c.webView.major < YOUTUBE_MIN_WEBVIEW) return { ok: false, reason: `has WebView ${c.webView.major}, YouTube needs ${YOUTUBE_MIN_WEBVIEW} or newer` };
  return { ok: true, reason: null };
}

export interface CrashReportPayload {
  /** ms since 1970, TV clock */
  at: number;
  /** e.g. "java.lang.OutOfMemoryError" */
  type: string;
  message: string | null;
  /** top stack frames, innermost first */
  frames: string[];
  /** every crash since the app was installed */
  total: number;
  /** crashes in the last 10 minutes */
  recent: number;
}

export type DeviceCommandType =
  | 'restart'
  | 'reload'
  | 'screenshot'
  | 'clearCache'
  | 'kioskUnlock'
  | 'kioskLock'
  /** Switch the panel off for 10 s and back on: finds out whether this TV model can sleep at night. */
  | 'screenOffTest'
  | 'emergency:show'
  | 'emergency:clear';

export interface DeviceCommandPayload {
  commandId: string;
  type: DeviceCommandType;
  params?: Record<string, unknown>;
}

/**
 * Sent when head office removes the screen. The only signal that makes a TV stop playing and
 * forget its content: a refused key alone (401) may be temporary (a restored database, a wrong
 * answer for a moment), so then the TV keeps playing and offers a new pairing code in a corner.
 */
export const DEVICE_REMOVED_EVENT = 'device:removed';

export interface ServerToDeviceEvents {
  'manifest:updated': (data: { version: string }) => void;
  command: (data: DeviceCommandPayload) => void;
  'device:removed': () => void;
}

/** TV -> server once a command is done (a screenshot is acknowledged by its upload instead). */
export interface CommandAckPayload {
  commandId: string;
  ok: boolean;
  /** Short reason when ok is false. */
  error?: string;
}

export interface DeviceToServerEvents {
  heartbeat: (data: HeartbeatPayload) => void;
  'command:ack': (data: CommandAckPayload) => void;
}

/** POST /api/devices/playlogs */
export interface PlayLogEntry {
  mediaId: string;
  startedAt: string; // ISO 8601 UTC
  durationMs: number;
  /** The TV's clock was not set: startedAt is its best guess. */
  clockUncertain?: boolean;
  /** Made by the TV for each play (UUID), so a resend counts once even with a corrected time. */
  playId?: string;
}

export interface PlayLogBatch {
  entries: PlayLogEntry[];
}
