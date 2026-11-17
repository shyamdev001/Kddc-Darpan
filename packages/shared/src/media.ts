import type { MediaType } from './enums';

export const MediaStatus = {
  UPLOADED: 'UPLOADED', // waiting in the processing queue
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];

/** A media item as the dashboard sees it (GET /api/media). Dates are ISO 8601 UTC. */
export interface MediaItem {
  id: string;
  displayName: string;
  originalName: string;
  type: MediaType;
  status: MediaStatus;
  errorMessage: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** Processed file size once READY, otherwise the uploaded size. */
  sizeBytes: number;
  originalSizeBytes: number;
  startDate: string | null;
  endDate: string | null;
  tags: string[];
  usedInPlaylists: number;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
  thumbUrl: string | null;
  fileUrl: string | null;
  /** Shown on any screen that has nothing else to play. At most one poster is the default slide. */
  defaultSlide: boolean;
}

export interface MediaListResponse {
  items: MediaItem[];
  counts: { all: number; images: number; videos: number; processing: number; failed: number };
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

/** Media list page size: default and largest allowed. */
export const MEDIA_PAGE_SIZE = 200;
export const MEDIA_PAGE_MAX = 500;

export interface UploadResult {
  created: MediaItem[];
  duplicates: { fileName: string; existingId: string; existingName: string }[];
  rejected: { fileName: string; reason: string }[];
}

export interface UpdateMediaRequest {
  displayName?: string;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[];
  /** Make this poster the default slide (true), or stop it being one (false). */
  defaultSlide?: boolean;
}
