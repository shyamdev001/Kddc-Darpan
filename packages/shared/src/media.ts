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
}

export interface MediaListResponse {
  items: MediaItem[];
  counts: { all: number; images: number; videos: number; processing: number; failed: number };
}

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
}
