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
}

/** POST /api/screens/claim (dashboard) */
export interface ClaimScreenRequest {
  pairingCode: string;
  name: string;
  branchId: string;
}

/** GET /api/devices/manifest */
export interface ManifestItem {
  mediaId: string;
  url: string;
  sha256: string;
  size: number;
  type: MediaType;
  durationSec: number;
}

export interface ManifestSettings {
  brightness?: number;
  screenOnTime?: string; // "HH:mm", Asia/Kolkata
  screenOffTime?: string;
}

export interface Manifest {
  version: string; // changes whenever content changes
  generatedAt: string; // ISO 8601 UTC
  items: ManifestItem[];
  schedule: unknown[]; // filled in Phase 2
  settings: ManifestSettings;
}

/** Socket.IO namespace `/devices` */
export const DEVICE_NAMESPACE = '/devices';

export interface HeartbeatPayload {
  currentMediaId: string | null;
  storageFreeBytes: number;
  ramFreeBytes: number;
  appVersion: string;
}

export type DeviceCommandType =
  | 'restart'
  | 'reload'
  | 'screenshot'
  | 'clearCache'
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

export interface DeviceToServerEvents {
  heartbeat: (data: HeartbeatPayload) => void;
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
