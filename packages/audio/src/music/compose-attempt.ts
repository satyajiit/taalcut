// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One generation attempt of path c (SPEC P3.5 steps 1–2): the composition plan at the asked tempo (the timeline's
 * length, its downbeats, the mood words and an optional prompt), `MusicProvider.compose`, the original stored byte
 * for byte through the sink (provenance `generated`) and written to the attempt's scratch folder for tracking.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ok,
  type AssetId,
  type AsyncResult,
  type GeneratedAssetSink,
  type GenerationTrace,
  type MusicProvider,
  type Timeline,
} from '@taalcut/core';
import { timelineMs } from '../timeline/span';
import { downbeatTimes, type BeatGrid } from './beat-grid';
import { planComposition, type PlanSection } from './composition-plan';
import { MUSIC_CONFIG } from './config';
import { musicProvenance } from './music-files';

export interface ComposeRequest {
  readonly timeline: Timeline;
  readonly mood?: readonly string[];
  readonly prompt?: string;
  readonly vocals?: boolean;
  readonly sections?: readonly PlanSection[];
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface ComposeDeps {
  readonly provider: MusicProvider;
  readonly sink: GeneratedAssetSink;
  readonly clock: { now(): number };
  /** Ask the provider to sign the track (open question P3.15-1). */
  readonly signWithC2pa?: boolean;
}

export interface Attempt {
  readonly request: ComposeRequest;
  readonly bpm: number;
  readonly target: BeatGrid | null;
  /** The attempt's scratch folder. */
  readonly dir: string;
  /** 1 or 2. */
  readonly n: number;
}

function compose(deps: ComposeDeps, { request, bpm, target }: Attempt) {
  const chunks = planComposition({
    durationMs: timelineMs(request.timeline),
    bpm,
    downbeatsMs: target ? downbeatTimes(target) : [],
    ...(request.sections ? { sections: request.sections } : {}),
    ...(request.mood ? { mood: request.mood } : {}),
    ...(request.vocals !== undefined ? { vocals: request.vocals } : {}),
  });
  const prompt = request.prompt?.trim();
  const plan = prompt
    ? chunks.map((c) => ({ ...c, text: `${c.text}. ${prompt}`.slice(0, MUSIC_CONFIG.chunk.maxTextChars) }))
    : chunks;
  return deps.provider.compose({
    plan: { kind: 'chunks', chunks: plan },
    signWithC2pa: deps.signWithC2pa ?? false,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.trace ? { trace: request.trace } : {}),
  });
}

export async function composeAttempt(
  deps: ComposeDeps,
  attempt: Attempt,
): AsyncResult<{
  readonly original: string;
  readonly stored: { readonly assetId: AssetId; readonly contentHash: string };
  readonly costUsd: number;
}> {
  const { request, bpm, n } = attempt;
  const composed = await compose(deps, attempt);
  if (!composed.ok) return composed;
  const extension = composed.value.mediaType === 'audio/wav' ? 'wav' : 'mp3';
  const promptSha256 = createHash('sha256')
    .update(JSON.stringify([bpm, request.mood ?? [], request.prompt ?? '']))
    .digest('hex');
  const stored = await deps.sink.put(
    {
      bytes: composed.value.bytes,
      mediaType: composed.value.mediaType,
      fileName: `music-${request.timeline.id.toLowerCase()}-${n}.${extension}`,
      projectId: request.timeline.projectId,
      provenance: musicProvenance(composed.value, promptSha256, deps.clock.now()),
    },
    request.signal ? { signal: request.signal } : {},
  );
  if (!stored.ok) return stored;
  const original = join(attempt.dir, `original-${n}.${extension}`);
  await writeFile(original, composed.value.bytes);
  return ok({ original, stored: stored.value, costUsd: composed.value.costUsd });
}
