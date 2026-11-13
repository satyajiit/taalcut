// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What a generated track is stored as: its provenance, and the derived key of its warp onto one beat map. */
import { createHash } from 'node:crypto';
import type { GeneratedProvenance, MusicResult } from '@taalcut/core';
import type { BeatGrid } from './beat-grid';
import { MUSIC_CONFIG } from './config';

const HASH = /^[0-9a-f]{64}$/;

export function musicProvenance(result: MusicResult, promptSha256: string, now: number): GeneratedProvenance {
  return {
    kind: 'generated',
    generation: 'music',
    provider: result.provider,
    model: result.model,
    access: 'api-key',
    quality: null,
    promptSha256,
    voiceId: null,
    providerRef: result.songId,
    c2pa: result.c2pa,
    costUsd: result.costUsd,
    runId: null,
    createdAt: now,
  };
}

/**
 * `warped/<hh>/<original hash>.t<target>.v<recipe>.flac`: one warp per original and target grid. The original's
 * library hash names it (the bytes' sha256 when the sink's hash isn't 64 hex); `t<target>` is the first 16 hex of
 * the sha256 of the target beats, so another timeline's warp of the same track gets its own file.
 */
export function warpedKey(contentHash: string, bytes: Uint8Array, target: BeatGrid): string {
  const hash = HASH.test(contentHash) ? contentHash : createHash('sha256').update(bytes).digest('hex');
  const grid = createHash('sha256')
    .update(JSON.stringify([target.beatsMs.map((b) => Math.round(b)), target.downbeats]))
    .digest('hex')
    .slice(0, 16);
  return `warped/${hash.slice(0, 2)}/${hash}.t${grid}.v${MUSIC_CONFIG.recipe}.flac`;
}
