// Turns an uploaded original into the file the TVs play, plus a dashboard thumbnail.
// Images: Sharp. Videos: FFmpeg (1080p H.264 MP4, AAC audio, fast start).
import { copyFile, rm } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { FFMPEG, FFPROBE, SCREEN_LONG, SCREEN_SHORT } from './media.constants';
import { run } from './file-utils';

sharp.cache(false); // keep memory flat while processing many posters

export interface TranscodeResult {
  outPath: string;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  durationSec: number | null;
  thumbPath: string;
}

const THUMB_MAX = 480;

function box(width: number, height: number) {
  return height > width
    ? { w: SCREEN_SHORT, h: SCREEN_LONG } // portrait poster for a portrait screen
    : { w: SCREEN_LONG, h: SCREEN_SHORT };
}

export async function transcodeImage(input: string, workDir: string, id: string): Promise<TranscodeResult> {
  const meta = await sharp(input).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new Error('This file is not a readable image.');

  // EXIF orientations 5-8 mean the stored pixels are rotated 90°.
  const rotated = (meta.orientation ?? 1) >= 5;
  const w = rotated ? meta.height : meta.width;
  const h = rotated ? meta.width : meta.height;
  const { w: bw, h: bh } = box(w, h);

  const outPath = join(workDir, `${id}.jpg`);
  const alreadyFine =
    meta.format === 'jpeg' && (meta.orientation ?? 1) === 1 && !meta.hasAlpha && w <= bw && h <= bh;

  if (alreadyFine) {
    // Re-encoding a poster that already fits would only lose quality and often grow the file.
    await copyFile(input, outPath);
  } else {
    await sharp(input)
      .rotate()
      .resize({ width: bw, height: bh, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outPath);
  }

  const out = await sharp(outPath).metadata();
  const thumbPath = join(workDir, `${id}.thumb.webp`);
  await sharp(outPath).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside' }).webp({ quality: 78 }).toFile(thumbPath);

  return {
    outPath,
    mimeType: 'image/jpeg',
    extension: '.jpg',
    width: out.width ?? w,
    height: out.height ?? h,
    durationSec: null,
    thumbPath,
  };
}

interface ProbeStream {
  codec_type: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}
interface Probe {
  streams: ProbeStream[];
  format: { duration?: string };
}

async function probe(path: string): Promise<Probe> {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], 120_000);
  return JSON.parse(out) as Probe;
}

function displaySize(stream: ProbeStream) {
  const rotation = Math.abs(Number(stream.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0));
  const turned = rotation === 90 || rotation === 270;
  return turned ? { w: stream.height ?? 0, h: stream.width ?? 0 } : { w: stream.width ?? 0, h: stream.height ?? 0 };
}

export async function transcodeVideo(input: string, workDir: string, id: string): Promise<TranscodeResult> {
  const info = await probe(input).catch(() => null);
  const video = info?.streams.find((s) => s.codec_type === 'video');
  if (!info || !video) throw new Error('This file has no playable video track.');

  const { w, h } = displaySize(video);
  const { w: bw, h: bh } = box(w, h);
  const outPath = join(workDir, `${id}.mp4`);

  await run(FFMPEG, [
    '-hide_banner', '-y',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    // Fit inside the screen, never upscale, keep even dimensions for H.264.
    '-vf', `scale='min(${bw},iw)':'min(${bh},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    outPath,
  ]);

  const out = await probe(outPath);
  const outVideo = out.streams.find((s) => s.codec_type === 'video');
  const duration = Number(out.format.duration ?? info.format.duration ?? 0);
  const durationSec = Math.max(1, Math.round(duration));

  // Thumbnail from 1 s in (or the middle of very short clips).
  const framePath = join(workDir, `${id}.frame.png`);
  const thumbPath = join(workDir, `${id}.thumb.webp`);
  await run(FFMPEG, ['-hide_banner', '-y', '-ss', String(Math.min(1, duration / 2)), '-i', outPath, '-frames:v', '1', framePath], 120_000);
  await sharp(framePath).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside' }).webp({ quality: 78 }).toFile(thumbPath);
  await rm(framePath, { force: true });

  return {
    outPath,
    mimeType: 'video/mp4',
    extension: '.mp4',
    width: outVideo?.width ?? w,
    height: outVideo?.height ?? h,
    durationSec,
    thumbPath,
  };
}
