import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const MEDIA_QUEUE = 'media-process';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export const MAX_IMAGE_BYTES = mb(process.env.MEDIA_MAX_IMAGE_MB, 30);
export const MAX_VIDEO_BYTES = mb(process.env.MEDIA_MAX_VIDEO_MB, 500);
export const MAX_FILES_PER_UPLOAD = 20;

/** Largest frame the TVs show. Portrait media uses the same box turned on its side. */
export const SCREEN_LONG = 1920;
export const SCREEN_SHORT = 1080;

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function mb(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 1024 * 1024;
}

/** Scratch folder for uploads in progress and FFmpeg output. Same drive as storage, so moves are instant. */
export function mediaTmpDir(): string {
  const dir = process.env.MEDIA_TMP_DIR || join(process.env.STORAGE_LOCAL_DIR || tmpdir(), 'tmp');
  mkdirSync(dir, { recursive: true });
  return dir;
}
