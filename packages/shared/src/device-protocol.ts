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
}

export type DeviceCommandType =
  | 'restart'
  | 'reload'
  | 'screenshot'
  | 'clearCache'
  | 'kioskUnlock'
  | 'kioskLock'
  | 'emergency:show'
  | 'emergency:clear';

export interface DeviceCommandPayload {
  commandId: string;
  type: DeviceCommandType;
  params?: Record<string, unknown>;
}

export interface ServerToDeviceEvents {
  'manifest:updated': (data: { version: string }) => void;
  command: (data: DeviceCommandPayload) => void;
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
}

export interface PlayLogBatch {
  entries: PlayLogEntry[];
}
