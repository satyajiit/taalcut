// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { checkReencode, type ReencodeProbe } from '../src/reencode';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const EXPORT = 'trim.3f1a9c2e-4b70-4d1a-8c55-0a1b2c3d4e5f.mov';

describe('iOS re-encode flags', () => {
  const receivedAt = 1_700_000_300_000;

  it('flags an iPhone H.264/AAC file with no camera metadata', () => {
    const check = checkReencode({
      userAgent: IOS,
      fileName: EXPORT,
      lastModified: receivedAt - 60_000,
      receivedAt,
      probe: { videoCodec: 'h264', audioCodec: 'aac' },
    });
    expect(check.verdict).toBe('likely');
    expect(check.reasons).toEqual(
      expect.arrayContaining([
        'ios-browser',
        'h264-aac',
        'no-camera-metadata',
        'export-file-name',
        'fresh-file-time',
      ]),
    );
  });

  it('does not flag HEVC or a file that still has camera metadata', () => {
    const hevc = check({ videoCodec: 'hevc', audioCodec: 'aac' }, IOS, EXPORT);
    expect(hevc.verdict).toBe('unlikely');
    expect(hevc.reasons).toContain('hevc');
    const camera = check(
      { videoCodec: 'h264', audioCodec: 'aac', tags: { 'com.apple.quicktime.make': 'Apple' } },
      IOS,
      'IMG_0001.MOV',
    );
    expect(camera.verdict).toBe('unlikely');
    expect(camera.reasons).toContain('camera-metadata');
  });

  it('does not flag a phone that is not iOS, and leaves a JPEG without a codec as unknown', () => {
    const android = check(
      { videoCodec: 'h264', audioCodec: 'aac' },
      'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      EXPORT,
    );
    expect(android.verdict).toBe('unlikely');
    const still = checkReencode({
      userAgent: IOS,
      fileName: 'photo.jpg',
      lastModified: null,
      receivedAt,
      probe: { jpeg: true, jpegHasCameraExif: false },
    });
    expect(still.verdict).toBe('unknown');
    expect(still.reasons).toContain('jpeg-without-camera-exif');
  });

  it('treats avc1 as H.264 and a stale file time as not fresh', () => {
    const avc = check({ videoCodec: 'avc1', audioCodec: 'aac' }, IOS, 'clip.mov');
    expect(avc.verdict).toBe('likely');
    const stale = checkReencode({
      userAgent: IOS,
      fileName: 'clip.mov',
      lastModified: receivedAt - 60 * 60 * 1000,
      receivedAt,
      probe: { videoCodec: 'h264', audioCodec: 'aac' },
    });
    expect(stale.reasons).not.toContain('fresh-file-time');
    expect(stale.verdict).toBe('likely');
  });
});

function check(probe: ReencodeProbe, userAgent: string, fileName: string) {
  return checkReencode({
    userAgent,
    fileName,
    lastModified: 1_700_000_300_000 - 30_000,
    receivedAt: 1_700_000_300_000,
    probe,
  });
}
