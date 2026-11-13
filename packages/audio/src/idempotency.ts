// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `<kind>:v<config>:<sha256 of the file fingerprint>:<range>:<language>`.
 * The fingerprint is hashed so a long path still fits the queue's 512-character key.
 */
import { createHash } from 'node:crypto';
import { AUDIO_CONFIG } from './config';

export function audioIdempotencyKey(
  kind: string,
  fingerprint: string,
  range: string,
  language: string,
): string {
  const hash = createHash('sha256').update(fingerprint).digest('hex');
  return `${kind}:v${AUDIO_CONFIG.version}:${hash}:${range}:${language}`;
}

/** `all` or `startMs-endMs` at the millisecond clock. */
export function rangeKey(range: { startMs: number; endMs: number } | undefined): string {
  if (!range) return 'all';
  return `${Math.round(range.startMs)}-${Math.round(range.endMs)}`;
}
