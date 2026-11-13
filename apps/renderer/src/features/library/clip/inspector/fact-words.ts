// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- codec names are product names, written as their makers write them */

/**
 * The clip's facts in words the inspector shows: codec names as their makers write them, shapes, colour and
 * quality. Product names aren't translated; the rest are Lingui messages.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { HdrKind } from '@taalcut/core';

const CODECS: Readonly<Record<string, string>> = {
  hevc: 'HEVC',
  h265: 'HEVC',
  h264: 'H.264',
  avc: 'H.264',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  prores: 'ProRes',
  mpeg4: 'MPEG-4',
  mjpeg: 'Motion JPEG',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'Apple Lossless',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
};

/** "HEVC", "H.264", "AAC"; an unknown codec as ffmpeg names it, in capitals; PCM for any of its sample formats. */
export function codecName(codec: string | undefined): string | null {
  if (!codec) return null;
  const key = codec.toLowerCase();
  if (key.startsWith('pcm_')) return 'PCM';
  return CODECS[key] ?? codec.toUpperCase();
}

export const SHAPE_WORDS: Readonly<Record<'portrait' | 'landscape' | 'square', MessageDescriptor>> = {
  portrait: msg`Vertical`,
  landscape: msg`Horizontal`,
  square: msg`Square`,
};

/** The short mark for a picture that isn't standard range; null for SDR. */
export const HDR_MARKS: Readonly<Record<HdrKind, string | null>> = {
  none: null,
  hlg: 'HDR · HLG',
  pq: 'HDR · PQ',
  'dolby-vision': 'Dolby Vision',
};

/** Quality in four words: the score's bands, not a percentage. */
export function qualityWord(score: number): MessageDescriptor {
  if (score >= 0.8) return msg`Great quality`;
  if (score >= 0.6) return msg`Good quality`;
  if (score >= 0.4) return msg`Fair quality`;
  return msg`Poor quality`;
}
