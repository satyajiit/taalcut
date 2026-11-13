// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** 16 kHz mono WAV for one speech slice, via media's `extractAudio`. */
import { ok, type AsyncResult } from '@taalcut/core';
import { extractAudio, type MediaContext } from '@taalcut/media';
import { audioNormalisation } from '../probe-plan';
import { msTime } from '../rates';

export async function extractSpeechSlice(
  ctx: MediaContext,
  path: string,
  range: { startMs: number; endMs: number },
  dest: string,
  signal?: AbortSignal,
): AsyncResult<string> {
  const plan = await audioNormalisation(path, ctx, signal);
  if (!plan.ok) return plan;
  const extracted = await extractAudio(path, plan.value, ctx, {
    sampleRate: 16_000,
    format: 'wav16',
    out: dest,
    range: {
      start: msTime(range.startMs),
      duration: msTime(Math.max(0, range.endMs - range.startMs)),
    },
    ...(signal ? { signal } : {}),
  });
  if (!extracted.ok) return extracted;
  return ok(dest);
}
