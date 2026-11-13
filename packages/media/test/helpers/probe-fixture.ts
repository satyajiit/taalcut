// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hand-made probe results and image bytes, for tests that run no FFmpeg. */
import type { ProbeResult, VideoStreamInfo } from '@taalcut/media';

/** A 320x240 8-bit H.264 stream unless overridden. */
export function videoStream(overrides: Partial<VideoStreamInfo> = {}): VideoStreamInfo {
  return {
    kind: 'video',
    index: 0,
    tags: {},
    codec: 'h264',
    profile: 'High',
    width: 320,
    height: 240,
    displayWidth: 320,
    displayHeight: 240,
    rotation: 0,
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    colour: {},
    isHdr: false,
    hdrFormats: [],
    vfrHint: false,
    isAttachedPicture: false,
    ...overrides,
  };
}

/** A probe of `path` with `video` as its only stream; `null` for a file without video. */
export function probeOf(path: string, video: VideoStreamInfo | null = videoStream()): ProbeResult {
  return {
    path,
    container: { formatName: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: video ? [video] : [],
    ...(video ? { video } : {}),
    chapters: [],
    tags: {},
  };
}

/** The first 24 bytes of a PNG: signature and IHDR with the given size. Enough for imageSize. */
export function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}
