// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The sound's passes: avSync against each source, and loudness and level in one decode. */
import { FrameRate, ok, type QaCheckResult, type Result } from '@taalcut/core';
import { loudnessCheck, silenceCheck } from '../checks/audio';
import { avSyncCheck } from '../checks/sync';
import { measureAudioLevels } from '../measure/audio-pass';
import type { StreamFacts } from '../measure/stream-facts';
import { measureWindows, type SyncWindow } from '../measure/sync';
import { unmeasured } from '../unmeasured';
import { timed, wants, type PassScope } from './scope';

/** Sound against its sources (avSync part 3), then the container and picture parts. */
export async function syncPass(
  scope: PassScope,
  facts: Result<StreamFacts> | undefined,
  scores: readonly number[],
): Promise<QaCheckResult[]> {
  if (!wants(scope, 'avSync')) return [];
  const { input, ctx } = scope;
  const started = performance.now();
  const rate = FrameRate.of(input.plan.rateNum, input.plan.rateDen);
  const frameSeconds = rate.den / rate.num;
  const windows: SyncWindow[] = input.plan.audio.windows.flatMap((window) => {
    const source = input.audioSources?.get(window.sourceId);
    return source
      ? [{ at: window.startFrame * frameSeconds, seconds: window.frames * frameSeconds, source }]
      : [];
  });
  const correlations =
    windows.length > 0 ? await measureWindows(ctx.media, input.file, windows, ctx.signal) : ok([]);
  const result =
    facts?.ok && correlations.ok
      ? avSyncCheck({
          facts: facts.value,
          plan: input.plan,
          sceneScores: scores,
          correlations: correlations.value,
        })
      : unmeasured('avSync', 'sync');
  return timed([result], started);
}

/** Loudness and level, one decode. A file with no audio stream at all fails both. */
export async function levelPass(scope: PassScope): Promise<QaCheckResult[]> {
  if (!wants(scope, 'loudness', 'silence')) return [];
  const { input, ctx } = scope;
  const started = performance.now();
  const levels = await measureAudioLevels(ctx.media, input.file, ctx.signal);
  const group: QaCheckResult[] = [];
  if (levels.ok) {
    if (wants(scope, 'loudness')) group.push(loudnessCheck(levels.value, input.plan, input.preset));
    if (wants(scope, 'silence')) group.push(silenceCheck(levels.value, input.plan));
  } else {
    for (const id of ['loudness', 'silence'] as const)
      if (scope.wanted.has(id)) group.push(unmeasured(id, 'audioPass'));
  }
  return timed(group, started);
}
