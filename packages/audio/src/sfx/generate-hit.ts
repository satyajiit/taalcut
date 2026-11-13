// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `sfx.generateHit` (SPEC P3.6): one new sound from the SfxProvider (`eleven_text_to_sound_v2`), measured for its
 * length, peak and loudness, stored byte for byte through the sink (provenance `generated`, the provider's C2PA
 * state as read) and placed with its peak on each chosen cut, next to the hits already on the effects track.
 */
import { createHash } from 'node:crypto';
import {
  err,
  newId,
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type Clock,
  type GeneratedAssetSink,
  type GeneratedProvenance,
  type GenerationTrace,
  type SfxHit,
  type SfxProvider,
  type SfxResult,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { LoudnessMeter } from '../mix/loudness-series';
import { timelineMs } from '../timeline/span';
import { timelineCuts } from './cuts';
import { CutUnknown } from './errors';
import { existingHits, toHits } from './hit-records';
import { planHits, type HitSound } from './hit-plan';
import { measureSoundShape } from './sound-shape';

export interface GenerateHitDeps {
  readonly sink: GeneratedAssetSink;
  readonly provider: SfxProvider;
  readonly media: MediaContext;
  readonly meter: LoudnessMeter;
  readonly clock: Clock;
  readonly scratchDir?: string;
}

export interface GenerateHitRequest {
  readonly timeline: Timeline;
  readonly prompt: string;
  readonly cutIndexes: readonly number[];
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

/** A short hit: long enough for a whoosh or an impact's tail, short enough to sit between cuts. */
const HIT = { durationSeconds: 2, promptInfluence: 0.5 } as const;

function provenanceOf(made: SfxResult, prompt: string, now: number): GeneratedProvenance {
  return {
    kind: 'generated',
    generation: 'soundEffect',
    provider: made.provider,
    model: made.model,
    access: 'api-key',
    quality: null,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    voiceId: null,
    providerRef: null,
    c2pa: made.c2pa,
    costUsd: made.costUsd,
    runId: null,
    createdAt: now,
  };
}

const endOf = (hit: SfxHit) => RationalTime.add(hit.at, hit.duration);
const overlaps = (a: SfxHit, b: SfxHit) =>
  RationalTime.isBefore(a.at, endOf(b)) && RationalTime.isBefore(b.at, endOf(a));

export async function generateHit(
  deps: GenerateHitDeps,
  request: GenerateHitRequest,
): AsyncResult<{ readonly hits: SfxHit[]; readonly costUsd: number; readonly assetId: AssetId }> {
  const cuts = timelineCuts(request.timeline);
  const missing = request.cutIndexes.find((i) => !cuts[i]);
  if (missing !== undefined) return err(CutUnknown({ cutIndex: missing }));
  const made = await deps.provider.generate({
    text: request.prompt,
    durationSeconds: HIT.durationSeconds,
    loop: false,
    promptInfluence: HIT.promptInfluence,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.trace ? { trace: request.trace } : {}),
  });
  if (!made.ok) return made;
  const extension = made.value.mediaType === 'audio/wav' ? 'wav' : 'mp3';
  const shape = await measureSoundShape(deps, made.value.bytes, extension, request.signal);
  if (!shape.ok) return shape;
  const id = newId<'TimelineItem'>().toLowerCase();
  const stored = await deps.sink.put(
    {
      bytes: made.value.bytes,
      mediaType: made.value.mediaType,
      fileName: `sfx-${id}.${extension}`,
      projectId: request.timeline.projectId,
      provenance: provenanceOf(made.value, request.prompt, deps.clock.now()),
    },
    request.signal ? { signal: request.signal } : {},
  );
  if (!stored.ok) return stored;
  // Planned like a pack sound, with its measured shape: its peak lands on each chosen cut.
  const sound: HitSound = { id, category: 'impact', ...shape.value };
  const chosen = new Set(request.cutIndexes);
  const planned = planHits({
    cuts: cuts.filter((c) => chosen.has(c.index)).map((c) => ({ ...c, transition: 'flash' as const })),
    items: [sound],
    density: 'everyCut',
    style: 'punchy',
    timelineMs: timelineMs(request.timeline),
  });
  const fresh = toHits(planned, new Map([[id, stored.value.assetId]]));
  const kept = existingHits(request.timeline).filter((h) => fresh.every((f) => !overlaps(h, f)));
  return ok({ hits: [...kept, ...fresh], costUsd: made.value.costUsd, assetId: stored.value.assetId });
}
