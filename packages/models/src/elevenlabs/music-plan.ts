// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A music request as `POST /v1/music/detailed`'s body (SPEC P3.2), checked against the API's limits before anything is
 * sent: a v2 composition plan is `{ chunks: { text, duration_ms, positive_styles, negative_styles }[] }`, at most 30
 * chunks of 3,000–120,000 ms and 600,000 ms in all (v2 models keep chunk durations); a prompt takes
 * `music_length_ms` (3,000–600,000) and `force_instrumental`, and no seed. There is no BPM field: tempo is a style.
 */
import { err, ok, type CompositionChunk, type MusicRequest, type Result } from '@taalcut/core';
import { ELEVENLABS_LIMITS, ELEVENLABS_MODELS } from './config';
import { MusicPlanInvalid } from './errors';

export interface MusicBody {
  readonly body: Record<string, unknown>;
  /** The music's length, what the request bills by. */
  readonly lengthMs: number;
}

type PromptPlan = Extract<MusicRequest['plan'], { kind: 'prompt' }>;

const { music: LIMITS } = ELEVENLABS_LIMITS;
const within = (value: number, range: { readonly min: number; readonly max: number }) =>
  Number.isInteger(value) && value >= range.min && value <= range.max;
const invalid = (field: string) => err(MusicPlanInvalid({ field }));

function promptBody(request: MusicRequest, plan: PromptPlan): Result<MusicBody> {
  if (plan.prompt.trim().length === 0) return invalid('prompt');
  if (!within(plan.lengthMs, LIMITS.totalMs)) return invalid('music_length_ms');
  if (request.seed !== undefined) return invalid('seed');
  return ok({
    body: {
      model_id: ELEVENLABS_MODELS.music,
      sign_with_c2pa: request.signWithC2pa,
      prompt: plan.prompt,
      music_length_ms: plan.lengthMs,
      force_instrumental: plan.instrumental,
    },
    lengthMs: plan.lengthMs,
  });
}

/** The first field of the plan outside the API's limits, or null; and the plan's length. */
function chunkProblem(chunks: readonly CompositionChunk[]): { field: string | null; lengthMs: number } {
  const lengthMs = chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
  if (chunks.length === 0 || chunks.length > LIMITS.chunks) return { field: 'chunks', lengthMs };
  for (const [i, chunk] of chunks.entries()) {
    if (!within(chunk.durationMs, LIMITS.chunkMs)) return { field: `chunks[${i}].duration_ms`, lengthMs };
    if (chunk.text.length > LIMITS.chunkText) return { field: `chunks[${i}].text`, lengthMs };
  }
  return { field: within(lengthMs, LIMITS.totalMs) ? null : 'chunks', lengthMs };
}

const wireChunk = (chunk: CompositionChunk) => ({
  text: chunk.text,
  duration_ms: chunk.durationMs,
  positive_styles: [...chunk.positiveStyles],
  negative_styles: [...chunk.negativeStyles],
});

function chunksBody(request: MusicRequest, chunks: readonly CompositionChunk[]): Result<MusicBody> {
  const { field, lengthMs } = chunkProblem(chunks);
  if (field) return invalid(field);
  const seed = request.seed;
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0)) return invalid('seed');
  return ok({
    body: {
      model_id: ELEVENLABS_MODELS.music,
      sign_with_c2pa: request.signWithC2pa,
      composition_plan: { chunks: chunks.map(wireChunk) },
      ...(seed !== undefined ? { seed } : {}),
    },
    lengthMs,
  });
}

export function musicBody(request: MusicRequest): Result<MusicBody> {
  return request.plan.kind === 'prompt'
    ? promptBody(request, request.plan)
    : chunksBody(request, request.plan.chunks);
}
