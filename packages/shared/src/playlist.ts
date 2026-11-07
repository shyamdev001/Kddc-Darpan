import type { MediaItem } from './media';

/** One row on the Playlists page. */
export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  defaultImageSec: number;
  itemCount: number;
  /** Length of one full loop in seconds. */
  loopSec: number;
  /** Thumbnails of the first few items, for the row preview. */
  previews: string[];
  /** Screens, branches, talukas or regions this playlist is assigned to. */
  assignmentCount: number;
  /** Items whose ad has ended or failed processing (skipped on screens). */
  attentionCount: number;
  updatedAt: string;
  createdBy: string | null;
}

export interface PlaylistEntry {
  id: string;
  position: number;
  /** Override in seconds; null = playlist default (images) or the video's own length. */
  durationSec: number | null;
  /** What the screen will actually use. */
  effectiveSec: number;
  media: MediaItem;
}

export interface PlaylistDetail extends Omit<PlaylistSummary, 'previews'> {
  items: PlaylistEntry[];
}

export interface CreatePlaylistRequest {
  name: string;
  description?: string | null;
  defaultImageSec?: number;
}

export interface UpdatePlaylistRequest {
  name?: string;
  description?: string | null;
  defaultImageSec?: number;
  /** Full ordered list. Replaces the current items. */
  items?: { mediaId: string; durationSec: number | null }[];
}

export const IMAGE_SEC_MIN = 3;
export const IMAGE_SEC_MAX = 300;
export const MAX_PLAYLIST_ITEMS = 500;
