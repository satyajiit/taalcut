// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stream facts: the format checks, duration and bitrate, and the container part avSync reads. */
import type { QaCheckResult, Result } from '@taalcut/core';
import {
  aspectRatioCheck,
  bitrateCheck,
  codecCheck,
  containerCheck,
  durationCheck,
  frameRateCheck,
  resolutionCheck,
} from '../checks/format';
import { readStreamFacts, type StreamFacts } from '../measure/stream-facts';
import { unmeasured } from '../unmeasured';
import { timed, wants, type PassScope } from './scope';

const FORMAT_IDS = [
  'container',
  'codec',
  'resolution',
  'aspectRatio',
  'frameRate',
  'duration',
  'bitrate',
] as const;

export async function formatPass(
  scope: PassScope,
): Promise<{ readonly results: QaCheckResult[]; readonly facts: Result<StreamFacts> | undefined }> {
  if (!wants(scope, ...FORMAT_IDS, 'avSync')) return { results: [], facts: undefined };
  const { input, ctx } = scope;
  const started = performance.now();
  const facts = await readStreamFacts(ctx.media, input.file, ctx.signal);
  const group: QaCheckResult[] = [];
  if (facts.ok) {
    const f = facts.value;
    if (wants(scope, 'container')) group.push(containerCheck(f));
    if (wants(scope, 'codec')) group.push(codecCheck(f, input.preset));
    if (wants(scope, 'resolution')) group.push(resolutionCheck(f, input.plan));
    if (wants(scope, 'aspectRatio')) group.push(aspectRatioCheck(f, input.plan));
    if (wants(scope, 'frameRate')) group.push(frameRateCheck(f, input.plan));
    if (wants(scope, 'duration')) group.push(durationCheck(f, input.plan, input.preset, input.target));
    if (wants(scope, 'bitrate')) group.push(bitrateCheck(f, input.preset, input.plan));
  } else {
    for (const id of FORMAT_IDS) if (scope.wanted.has(id)) group.push(unmeasured(id, 'probe'));
  }
  return { results: timed(group, started), facts };
}
