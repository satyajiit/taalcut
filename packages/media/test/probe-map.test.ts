// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Probe validation and mapping without FFmpeg. The iPhone fixture is
 * hand-made in the shape of ffprobe 9 output for an iPhone HDR portrait clip
 * (Dolby Vision 8.4 over HLG, display matrix -90), because no LGPL FFmpeg can
 * write Dolby Vision side data for a generated fixture.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProbeJson, probeMedia, type MediaContext, type ProcessRunner } from '@taalcut/media';
import { rotationOf } from '../src/probe/map-video';
import { phoneMetadataOf } from '../src/probe/map';
import { streamSchema } from '../src/probe/schema';

const iphoneJson = readFileSync(
  new URL('./fixtures/iphone-hdr-portrait.ffprobe.json', import.meta.url),
  'utf8',
);
const thisFile = fileURLToPath(import.meta.url);

function contextReturning(stdout: string, exitCode = 0, stderrTail = ''): MediaContext {
  const runner: ProcessRunner = async () => ({
    ok: true,
    value: { exitCode, signal: null, stdout: Buffer.from(stdout), stderrTail, durationMs: 1 },
  });
  return { binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' }, runner };
}

describe('parseProbeJson: iPhone HDR portrait clip', () => {
  const result = parseProbeJson('/Volumes/Trip/IMG_0420.MOV', iphoneJson);
  const probe = result.ok ? result.value : undefined;

  it('maps the container, duration and creation time', () => {
    expect(result.ok).toBe(true);
    expect(probe?.container).toEqual({
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      longName: 'QuickTime / MOV',
      majorBrand: 'qt  ',
      sizeBytes: 6631245,
      bitRate: 10607275,
    });
    expect(probe?.duration).toEqual({ value: 5001667, rate: 1000000 });
    // The phone's local time with offset wins over the container's UTC creation_time.
    expect(probe?.creationTime).toBe('2026-10-01T15:30:00+0530');
  });

  it('maps rotation, HDR and Dolby Vision', () => {
    const video = probe?.video;
    expect(video).toMatchObject({
      codec: 'hevc',
      profile: 'Main 10',
      width: 1920,
      height: 1080,
      rotation: 90,
      displayWidth: 1080,
      displayHeight: 1920,
      bitDepth: 10,
      colour: { range: 'tv', space: 'bt2020nc', transfer: 'arib-std-b67', primaries: 'bt2020' },
      isHdr: true,
      hdrFormats: ['hlg', 'dolby_vision'],
      dolbyVision: {
        profile: 8,
        level: 4,
        compatibilityId: 4,
        rpuPresent: true,
        enhancementLayerPresent: false,
        baseLayerPresent: true,
      },
    });
  });

  it('keeps frame rates and times exact and flags variable frame rate', () => {
    expect(probe?.video).toMatchObject({
      frameRate: { num: 30, den: 1 },
      averageFrameRate: { num: 1199, den: 40 }, // 17985/600, reduced
      vfrHint: true,
      timeBase: { num: 1, den: 600 },
      duration: { value: 3001, rate: 600 },
      startTime: { value: 0, rate: 600 },
      frameCount: 150,
    });
  });

  it('maps audio, data streams and phone metadata', () => {
    expect(probe?.audio).toMatchObject({
      codec: 'aac',
      channels: 2,
      sampleRate: 44100,
      duration: { value: 220500, rate: 44100 },
    });
    expect(probe?.audio?.language).toBeUndefined();
    expect(probe?.streams.map((s) => s.kind)).toEqual(['video', 'audio', 'data']);
    expect(probe?.streams[2]?.bitRate).toBeUndefined();
    expect(probe?.phone).toEqual({
      make: 'Apple',
      model: 'iPhone 17 Pro',
      software: '26.0.1',
      creationDate: '2026-10-01T15:30:00+0530',
      location: '+19.0760+072.8777+010.000/',
      livePhotoId: '5D6B9C4E-2F1A-4B7C-9E3D-8A1F2C3B4D5E',
    });
  });

  it('is plain data that survives JSON', () => {
    expect(JSON.parse(JSON.stringify(probe))).toEqual(JSON.parse(JSON.stringify(probe)));
    expect(structuredClone(probe)).toEqual(probe);
  });
});

describe('mapping details', () => {
  const video = (extra: object) => streamSchema.parse({ index: 0, codec_type: 'video', ...extra });

  it.each([
    [-90, 90],
    [90, 270],
    [180, 180],
    [-180, 180],
    [0, 0],
    [-89.9, 90],
  ])('display matrix rotation %d (counter-clockwise) is %d clockwise', (ccw, clockwise) => {
    expect(rotationOf(video({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: ccw }] }))).toBe(
      clockwise,
    );
  });

  it('falls back to the legacy clockwise rotate tag', () => {
    expect(rotationOf(video({ tags: { rotate: '90' } }))).toBe(90);
    expect(rotationOf(video({}))).toBe(0);
  });

  it('reads Android metadata', () => {
    expect(
      phoneMetadataOf({
        'com.android.manufacturer': 'Google',
        'com.android.model': 'Pixel 11',
        'com.android.version': '17',
        'com.android.capture.fps': '240.000000',
        location: '+37.4219-122.0840/',
      }),
    ).toEqual({
      make: 'Google',
      model: 'Pixel 11',
      software: '17',
      captureFrameRate: 240,
      location: '+37.4219-122.0840/',
    });
    expect(phoneMetadataOf({ encoder: 'Lavf63' })).toBeUndefined();
  });

  it('takes the first of a repeated tag, which ffprobe joins with ";"', () => {
    const raw = JSON.parse(iphoneJson) as { format: { tags: Record<string, string> } };
    const twice = (value: string) => `${value};${value.replace('15:30', '15:31')}`;
    const tags = raw.format.tags;
    const phoneDate = tags['com.apple.quicktime.creationdate'] ?? '';
    tags['com.apple.quicktime.creationdate'] = twice(phoneDate);
    tags['com.apple.quicktime.make'] = 'Apple;Apple';
    const phone = parseProbeJson('/a.mov', JSON.stringify(raw));
    expect(phone.ok && phone.value.creationTime).toBe('2026-10-01T15:30:00+0530');
    expect(phone.ok && phone.value.phone?.make).toBe('Apple');

    delete tags['com.apple.quicktime.creationdate'];
    tags.creation_time = '2026-10-01T10:00:00.000000Z;2026-10-01T10:00:01.000000Z';
    const container = parseProbeJson('/a.mov', JSON.stringify(raw));
    expect(container.ok && container.value.creationTime).toBe('2026-10-01T10:00:00.000000Z');
  });

  it('detects PQ, derives bit depth from the pixel format and ignores cover art', () => {
    const json = JSON.stringify({
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'mjpeg',
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        {
          index: 1,
          codec_type: 'video',
          codec_name: 'hevc',
          width: 3840,
          height: 2160,
          pix_fmt: 'p010le',
          color_transfer: 'smpte2084',
          r_frame_rate: '24000/1001',
          avg_frame_rate: '24000/1001',
        },
      ],
      format: { filename: 'a.mkv', nb_streams: 2, format_name: 'matroska,webm' },
    });
    const result = parseProbeJson('/a.mkv', json);
    expect(result.ok && result.value.video).toMatchObject({
      index: 1,
      bitDepth: 10,
      hdrFormats: ['pq'],
      isHdr: true,
      vfrHint: false,
      frameRate: { num: 24000, den: 1001 },
      rotation: 0,
    });
    expect(result.ok && result.value.streams[0]).toMatchObject({ kind: 'video', isAttachedPicture: true });
    expect(result.ok && result.value.chapters).toEqual([]);
  });
});

describe('malformed ffprobe output', () => {
  it('rejects text that is not JSON', async () => {
    const result = await probeMedia(thisFile, contextReturning('Segmentation fault'));
    // The name for a window's message; the full path only in detail, which core strips before a window.
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.probe_failed',
      params: { name: 'probe-map.test.ts' },
    });
    expect(!result.ok && result.error.params).toEqual({ name: 'probe-map.test.ts' });
    expect(!result.ok && result.error.detail).toMatch(/invalid JSON/);
    expect(!result.ok && result.error.detail).toContain(realpathSync(thisFile));
  });

  it('rejects JSON that does not match the schema, naming the field', async () => {
    const bad = JSON.stringify({
      streams: [{ index: 0, codec_type: 'video', width: 'wide', r_frame_rate: '29.97' }],
      format: { filename: 'x', nb_streams: 1, format_name: 'mov' },
    });
    const result = await probeMedia(thisFile, contextReturning(bad));
    expect(!result.ok && result.error.code).toBe('media.probe_failed');
    expect(!result.ok && result.error.detail).toMatch(/schema validation[\s\S]*streams\[0\]\.width/);
    expect(!result.ok && result.error.detail).toMatch(/r_frame_rate/);
  });

  it('rejects output with no format section', async () => {
    const result = await probeMedia(thisFile, contextReturning('{\n\n}'));
    expect(!result.ok && result.error.detail).toMatch(/format/);
  });

  it('rejects a file with neither audio nor video', async () => {
    const json = JSON.stringify({
      streams: [{ index: 0, codec_type: 'subtitle' }],
      format: { filename: 'x', nb_streams: 1, format_name: 'srt' },
    });
    const result = await probeMedia(thisFile, contextReturning(json));
    expect(!result.ok && result.error.detail).toMatch(/no audio or video stream/);
  });

  it('maps a failed ffprobe run to media.probe_failed with the stderr tail', async () => {
    const result = await probeMedia(
      thisFile,
      contextReturning('{}', 1, 'moov atom not found\nInvalid data found when processing input'),
    );
    expect(!result.ok && result.error).toMatchObject({ code: 'media.probe_failed' });
    expect(!result.ok && result.error.detail).toContain('Invalid data found');
  });

  it('reports a missing file before running ffprobe', async () => {
    let ran = false;
    const ctx: MediaContext = {
      binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' },
      runner: async () => {
        ran = true;
        throw new Error('should not run');
      },
    };
    const result = await probeMedia('/no/such/clip.mov', ctx);
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.file_not_found',
      params: { name: 'clip.mov' },
      detail: '/no/such/clip.mov: ENOENT',
    });
    expect(!result.ok && JSON.stringify(result.error.params)).not.toContain('/');
    expect(ran).toBe(false);
  });
});
