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

/**
 * Colours every TV shows the same way: sRGB (or grey), with no colour profile or an sRGB one.
 * Print posters are often CMYK or Adobe RGB: browsers show them right, so the dashboard looks fine,
 * but Android TVs show wrong colours or nothing (docs/AUDIT.md, DC1). Those are converted.
 */
export function plainColours(meta: { space?: string; icc?: Buffer }): boolean {
  if (meta.space !== 'srgb' && meta.space !== 'b-w') return false;
  return !meta.icc || meta.icc.includes('sRGB');
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
    meta.format === 'jpeg' && (meta.orientation ?? 1) === 1 && !meta.hasAlpha && w <= bw && h <= bh && plainColours(meta);

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

export interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  field_order?: string;
  color_transfer?: string;
  sample_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}
export interface Probe {
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

/**
 * The one video profile every TV gets, whatever was uploaded (docs/AUDIT.md, DC2): H.264 High at
 * level 4.0, at most 1920x1080 (portrait 1080x1920), constant frame rate of at most 30, 8-bit 4:2:0,
 * bitrate capped, a keyframe every 2 s (quick mid-way starts for screens kept in step), AAC 48 kHz.
 */
export const VIDEO_PROFILE = { level: 40, maxFps: 30, maxrate: '8M', bufsize: '16M', keyframeSec: 2, audioRate: 48_000 } as const;

const STANDARD_RATES: [string, number][] = [
  ['15', 15],
  ['20', 20],
  ['24000/1001', 24000 / 1001],
  ['24', 24],
  ['25', 25],
  ['30000/1001', 30000 / 1001],
  ['30', 30],
];

function rate(text: string | undefined): number {
  const [n, d] = (text ?? '').split('/').map(Number);
  const v = d ? n / d : n;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** The output frame rate: the standard rate nearest the source's average, never above 30. Pure. */
export function outputRate(stream: Pick<ProbeStream, 'avg_frame_rate' | 'r_frame_rate'>): { text: string; fps: number } {
  const src = rate(stream.avg_frame_rate) || rate(stream.r_frame_rate);
  if (!src || src > VIDEO_PROFILE.maxFps + 0.5) return { text: '30', fps: 30 };
  let best = STANDARD_RATES[0];
  for (const r of STANDARD_RATES) if (Math.abs(r[1] - src) < Math.abs(best[1] - src)) best = r;
  return { text: best[0], fps: best[1] };
}

/** The video filters for this source: deinterlace, HDR tone-map, fit the box, 8-bit 4:2:0. Pure. */
export function videoFilters(stream: Pick<ProbeStream, 'field_order' | 'color_transfer'>, bw: number, bh: number): string {
  const f: string[] = [];
  if (['tt', 'bb', 'tb', 'bt'].includes(stream.field_order ?? '')) f.push('yadif');
  if (stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67') {
    // HDR (iPhone, newer Android phones): without this the colours come out grey and washed out.
    f.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  }
  // Fit inside the screen, never upscale, keep even dimensions for H.264.
  f.push(`scale='min(${bw},iw)':'min(${bh},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, 'format=yuv420p');
  return f.join(',');
}

/** Why the encoded file is not what every TV can play, or null when it is. Pure. */
export function profileProblem(out: Probe, bw: number, bh: number): string | null {
  const v = out.streams.find((s) => s.codec_type === 'video');
  if (!v) return 'no video track';
  if (v.codec_name !== 'h264') return `codec ${v.codec_name}`;
  if (v.profile !== 'High') return `H.264 profile ${v.profile}`;
  if (!v.level || v.level > VIDEO_PROFILE.level) return `H.264 level ${v.level}`;
  if (v.pix_fmt !== 'yuv420p') return `pixel format ${v.pix_fmt}`;
  if (!v.width || !v.height || v.width > bw || v.height > bh) return `size ${v.width}x${v.height}`;
  if (rate(v.avg_frame_rate) > VIDEO_PROFILE.maxFps + 0.5) return `frame rate ${v.avg_frame_rate}`;
  const a = out.streams.find((s) => s.codec_type === 'audio');
  if (a && (a.codec_name !== 'aac' || Number(a.sample_rate) !== VIDEO_PROFILE.audioRate)) return `audio ${a.codec_name} ${a.sample_rate} Hz`;
  return null;
}

export async function transcodeVideo(input: string, workDir: string, id: string): Promise<TranscodeResult> {
  const info = await probe(input).catch(() => null);
  const video = info?.streams.find((s) => s.codec_type === 'video');
  if (!info || !video) throw new Error('This file has no playable video track.');

  const { w, h } = displaySize(video);
  const { w: bw, h: bh } = box(w, h);
  const outPath = join(workDir, `${id}.mp4`);
  const fps = outputRate(video);

  await run(FFMPEG, [
    '-hide_banner', '-y',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', videoFilters(video, bw, bh),
    // Constant frame rate: phone clips are variable, which stutters on some TV decoders.
    '-r', fps.text, '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
    '-maxrate', VIDEO_PROFILE.maxrate, '-bufsize', VIDEO_PROFILE.bufsize,
    '-g', String(Math.round(fps.fps * VIDEO_PROFILE.keyframeSec)),
    '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', String(VIDEO_PROFILE.audioRate),
    '-movflags', '+faststart',
    outPath,
  ]);

  const out = await probe(outPath);
  // Never hand the TVs a file outside the safe profile, whatever this FFmpeg build did.
  const problem = profileProblem(out, bw, bh);
  if (problem) throw new Error(`The converted video is not in the format every TV can play (${problem}).`);
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
