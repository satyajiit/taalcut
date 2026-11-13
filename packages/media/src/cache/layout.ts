// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content-addressed keys. The hash is the library's BLAKE3, opaque here:
 * a key never contains a path, so it can cross IPC to the renderer.
 */
import { DERIVED_KEY_PATTERN, type DerivedKind } from '@taalcut/core';

export const KIND_DIR: Record<DerivedKind, string> = {
  proxy: 'proxies',
  thumbnail: 'thumbnails',
  filmstrip: 'filmstrips',
  waveform: 'waveforms',
  still: 'stills',
  conformed: 'conformed',
  // P3 kinds, written by audio, render and vision.
  mixAudio: 'mix',
  warpedMusic: 'warped',
  subjectTrack: 'subjects',
  gradeLut: 'grades',
  speechCleanup: 'speech',
  lookStats: 'looks',
  soundListen: 'listen',
};

const HASH = /^[0-9a-f]{64}$/;

export function isContentHash(hash: string): boolean {
  return HASH.test(hash);
}

/**
 * `<kind dir>/<hash[0..2]>/<hash>[.<variant>].v<recipe>.<ext>`.
 * `variant` is dot-separated segments, each `[a-z0-9-]{1,32}`.
 */
export function derivedKey(
  kind: DerivedKind,
  hash: string,
  recipe: number,
  ext: 'mp4' | 'jpg' | 'json' | 'bin',
  variant?: string,
): string {
  const extra = variant ? `.${variant}` : '';
  return `${KIND_DIR[kind]}/${hash.slice(0, 2)}/${hash}${extra}.v${recipe}.${ext}`;
}

export function isDerivedKey(key: string): boolean {
  return DERIVED_KEY_PATTERN.test(key);
}

export function hashFromKey(key: string): string | undefined {
  const match = /\/([0-9a-f]{64})(?=\.|$)/.exec(key);
  return match?.[1];
}
