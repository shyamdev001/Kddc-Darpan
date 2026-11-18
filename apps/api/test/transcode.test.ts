// What the TVs get from an upload: every poster in plain sRGB, every video in the one safe profile
// the weakest TV decodes (docs/AUDIT.md, DC1 and DC2). Video cases need FFmpeg and skip without it.
import './env'; // FFMPEG_PATH / FFPROBE_PATH from .env, as the app uses them
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { spawnSync } from 'child_process';
import { FFMPEG, FFPROBE } from '../src/media/media.constants';
import { outputRate, plainColours, profileProblem, transcodeImage, transcodeVideo, videoFilters, type Probe } from '../src/media/transcode';

const hasFfmpeg = !spawnSync(FFMPEG, ['-version']).error && !spawnSync(FFPROBE, ['-version']).error;
const noFfmpeg = hasFfmpeg ? false : 'FFmpeg is not installed here';

function probeFile(path: string): Probe {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { encoding: 'utf8' });
  return JSON.parse(r.stdout) as Probe;
}

/** A test clip made by FFmpeg itself. */
function makeClip(path: string, args: string[]) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, path], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

const work = () => mkdtempSync(join(tmpdir(), 'darpan-transcode-'));

describe('posters reach every TV in plain sRGB (DC1)', () => {
  it('a CMYK poster that already fits is converted, not copied', async () => {
    const dir = work();
    try {
      const input = join(dir, 'print.jpg');
      writeFileSync(input, await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c0392b' } }).toColourspace('cmyk').jpeg().toBuffer());
      assert.equal((await sharp(input).metadata()).space, 'cmyk');

      const out = await transcodeImage(input, dir, 'cmyk');
      const meta = await sharp(out.outPath).metadata();
      assert.equal(meta.format, 'jpeg');
      assert.equal(meta.space, 'srgb');
      assert.equal(meta.width, 1200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a plain sRGB poster that fits is still copied byte for byte', async () => {
    const dir = work();
    try {
      const input = join(dir, 'plain.jpg');
      writeFileSync(input, await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#2e86de' } }).jpeg({ quality: 80 }).toBuffer());
      const out = await transcodeImage(input, dir, 'plain');
      assert.deepEqual(readFileSync(out.outPath), readFileSync(input));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('only sRGB or grey, without a foreign colour profile, counts as plain', () => {
    assert.equal(plainColours({ space: 'srgb' }), true);
    assert.equal(plainColours({ space: 'b-w' }), true);
    assert.equal(plainColours({ space: 'srgb', icc: Buffer.from('....desc sRGB IEC61966-2.1') }), true);
    assert.equal(plainColours({ space: 'srgb', icc: Buffer.from('....desc Adobe RGB (1998)') }), false);
    assert.equal(plainColours({ space: 'cmyk' }), false);
    assert.equal(plainColours({}), false);
  });
});

describe('every video ends up in the one safe profile (DC2)', () => {
  it('the frame rate is the nearest standard one, never above 30', () => {
    assert.deepEqual(outputRate({ avg_frame_rate: '25/1' }), { text: '25', fps: 25 });
    assert.equal(outputRate({ avg_frame_rate: '30000/1001' }).text, '30000/1001');
    assert.equal(outputRate({ avg_frame_rate: '1789/60' }).text, '30000/1001'); // a phone's variable 29.8
    assert.equal(outputRate({ avg_frame_rate: '50/1' }).text, '30');
    assert.equal(outputRate({ avg_frame_rate: '0/0', r_frame_rate: '24/1' }).text, '24');
    assert.equal(outputRate({}).text, '30');
  });

  it('interlaced and HDR sources get deinterlaced and tone-mapped first', () => {
    assert.doesNotMatch(videoFilters({}, 1920, 1080), /yadif|tonemap/);
    assert.match(videoFilters({ field_order: 'tt' }, 1920, 1080), /^yadif,/);
    assert.match(videoFilters({ color_transfer: 'smpte2084' }, 1920, 1080), /tonemap=tonemap=hable/);
    assert.match(videoFilters({ color_transfer: 'arib-std-b67' }, 1920, 1080), /tonemap/);
    assert.match(videoFilters({}, 1920, 1080), /format=yuv420p$/);
  });

  it('a file outside the profile is named for what is wrong', () => {
    const good: Probe = {
      streams: [
        { codec_type: 'video', codec_name: 'h264', profile: 'High', level: 40, pix_fmt: 'yuv420p', width: 1920, height: 1080, avg_frame_rate: '30/1' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
      ],
      format: {},
    };
    assert.equal(profileProblem(good, 1920, 1080), null);
    const bad = (v: object, a: object = {}): Probe => ({ streams: [{ ...good.streams[0], ...v }, { ...good.streams[1], ...a }], format: {} });
    assert.match(profileProblem(bad({ level: 41 }), 1920, 1080)!, /level 41/);
    assert.match(profileProblem(bad({ profile: 'High 10' }), 1920, 1080)!, /profile/);
    assert.match(profileProblem(bad({ pix_fmt: 'yuv420p10le' }), 1920, 1080)!, /pixel format/);
    assert.match(profileProblem(bad({ avg_frame_rate: '60/1' }), 1920, 1080)!, /frame rate/);
    assert.match(profileProblem(bad({}, { sample_rate: '96000' }), 1920, 1080)!, /audio/);
    assert.match(profileProblem(bad({ width: 1920, height: 1080 }), 1080, 1920)!, /size/);
  });

  it('a 4K 50 fps 10-bit HDR interlaced clip with 96 kHz audio comes out as H.264 High 4.0, 1080p30, yuv420p, AAC 48 kHz', { skip: noFfmpeg, timeout: 180_000 }, async () => {
    const dir = work();
    try {
      const input = join(dir, 'phone.mkv');
      makeClip(input, [
        '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=50:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=96000:duration=2',
        '-c:v', 'ffv1', '-pix_fmt', 'yuv420p10le', '-field_order', 'tt',
        '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
        '-c:a', 'flac', '-shortest',
      ]);
      const out = await transcodeVideo(input, dir, 'phone');
      const p = probeFile(out.outPath);
      assert.equal(profileProblem(p, 1920, 1080), null);
      const v = p.streams.find((s) => s.codec_type === 'video')!;
      assert.equal(v.width, 1920);
      assert.equal(v.height, 1080);
      assert.equal(v.avg_frame_rate, '30/1');
      assert.equal(v.level, 40);
      assert.equal(p.streams.find((s) => s.codec_type === 'audio')?.sample_rate, '48000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a portrait phone clip stays portrait and is never upscaled', { skip: noFfmpeg, timeout: 120_000 }, async () => {
    const dir = work();
    try {
      const input = join(dir, 'portrait-in.mp4');
      makeClip(input, ['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
      const out = await transcodeVideo(input, dir, 'portrait');
      assert.equal(out.width, 720);
      assert.equal(out.height, 1280);
      const v = probeFile(out.outPath).streams.find((s) => s.codec_type === 'video')!;
      assert.equal(v.avg_frame_rate, '25/1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
