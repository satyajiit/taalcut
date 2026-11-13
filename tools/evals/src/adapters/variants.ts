// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planVariants on the hook axis, over an in-memory catalogue. No video files and no library on disk.
 * Slot intents are one-hot vectors; each slot's shots sit near that vector and far from the others.
 */
import {
  FrameRate,
  HOOK_WINDOW_SECONDS,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type Embedder,
  type ShotProfile,
  type Timeline,
} from '@taalcut/core';
import {
  assemble,
  createCastingEngine,
  createMemoryShotCatalog,
  memoryTemplateReader,
  planVariants,
  profileKey,
} from '@taalcut/timeline';
import { fixtureTemplate } from '../casting/template';
import { VARIANT_CASE_ID, VARIANT_COUNT } from '../variants/fixtures';
import type { VariantLabel, VariantPrediction, VariantRow } from '../variants/schema';
import { requireSyntheticLabels } from './synthetic-only';

const SLOTS = 12;
const PER_SLOT = 8;
const DIM = 32;
const RATE = FrameRate.of(30);

function unit(slot: number, extra: number | null, extraWeight: number): Float32Array {
  const vector = new Float32Array(DIM);
  vector[slot] = 1;
  if (extra !== null) vector[extra] = extraWeight;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  return vector.map((value) => value / norm);
}

interface Library {
  readonly profiles: ShotProfile[];
  readonly acceptable: string[][];
  readonly embedder: Embedder;
}

function library(): Library {
  const acceptable: string[][] = [];
  const profiles: ShotProfile[] = [];
  const vectors = new Map<string, Float32Array>();
  for (let slot = 0; slot < SLOTS; slot += 1) {
    const text = `slot-${slot}`;
    vectors.set(text, unit(slot, null, 0));
    const keys: string[] = [];
    for (let shot = 0; shot < PER_SLOT; shot += 1) {
      const profile: ShotProfile = {
        assetId: newId<'Asset'>(),
        shotId: newId<'Shot'>(),
        kind: 'video',
        range: TimeRange.of(RationalTime.zero(RATE), RationalTime.of(240, RATE)),
        available: TimeRange.of(RationalTime.zero(RATE), RationalTime.of(300, RATE)),
        orientation: 'portrait',
        quality: 0.72 + shot * 0.02,
        sharpness: 0.8,
        motionClass: 'static',
        energy: 0.5,
        faceCount: 1,
        placeClusterId: `place-${slot}-${shot}`,
        objectTags: [],
        capturedAt: 1_700_000_000_000 + slot * 100 + shot,
        fileDate: 1_700_000_000_000,
        duplicateGroup: null,
        bestTake: true,
        sourceId: null,
        embedding: unit(slot, 16 + shot, 0.5),
        motionCurve: null,
        sharpnessCurve: null,
        motionPeakFrames: [],
      };
      profiles.push(profile);
      keys.push(profileKey(profile));
    }
    acceptable.push(keys);
  }
  const embedder: Embedder = {
    space: { model: 'fake', revision: 'test', dimensions: DIM, indexName: 'fake_test' },
    async embedTexts(texts, options) {
      if (options.purpose !== 'query' && options.purpose !== 'document') {
        throw new Error(`unexpected embedding purpose ${options.purpose}`);
      }
      return ok(
        texts.map((text) => {
          const vector = vectors.get(text);
          if (vector === undefined) throw new Error(`no embedding for ${text}`);
          return vector;
        }),
      );
    },
  };
  return { profiles, acceptable, embedder };
}

function picksOf(timeline: Timeline): { key: string; frame: number }[] {
  const track = timeline.tracks.find((item) => item.kind === 'video');
  if (track === undefined) return [];
  const rate = timeline.canvas.rate;
  let frame = 0;
  const picks: { key: string; frame: number }[] = [];
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    const frames = RationalTime.toFrames(item.duration, rate);
    if (item.type === 'clip' && item.media.kind === 'video') {
      picks.push({ key: item.media.shotId ?? `asset:${item.media.assetId}`, frame });
    }
    frame += frames;
  }
  return picks;
}

function rowOf(timeline: Timeline): VariantRow {
  const picks = picksOf(timeline);
  const rate = timeline.canvas.rate;
  const hook = picks
    .filter((pick) => pick.frame * rate.den < HOOK_WINDOW_SECONDS * rate.num)
    .map((pick) => pick.key)
    .join('|');
  return { id: timeline.id, hook, picks: picks.map((pick) => pick.key) };
}

export interface PlannedVariants {
  readonly label: VariantLabel;
  readonly prediction: VariantPrediction;
}

/** Five hook variants from planVariants, with the acceptable shot ids the catalogue was built from. */
export async function planHookVariants(): Promise<PlannedVariants> {
  const built = library();
  const template = fixtureTemplate(
    Array.from({ length: SLOTS }, (_, slot) => ({
      frames: 30,
      intent: `slot-${slot}`,
      motion: null,
      energy: 0.5,
    })),
  );
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(built.profiles),
    embedder: built.embedder,
  });
  const projectId = newId<'Project'>();
  const cast = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
  if (!cast.ok) throw new Error(`cast: ${cast.error.code}`);
  const variant = cast.value.variants[0];
  if (variant === undefined) throw new Error('cast: no variant');
  const assembled = assemble(
    {
      projectId,
      template,
      variant,
      cast: {
        castId: cast.value.castId,
        mode: 'template',
        variantIndex: 0,
        variantCount: 1,
        configVersion: cast.value.configVersion,
      },
      timelineId: newId<'Timeline'>(),
      name: 'Hook case',
      now: 1_700_000_000_000,
    },
    { item: () => newId<'TimelineItem'>() },
  );
  if (!assembled.ok) throw new Error(`assemble: ${assembled.error.code}`);
  const timelineIds = Array.from({ length: VARIANT_COUNT }, () => newId<'Timeline'>());
  const plan = await planVariants(
    {
      count: VARIANT_COUNT,
      axes: ['hook'],
      base: assembled.value,
      timelineIds,
      castId: newId<'Cast'>(),
      seed: 'p3-q2-variants',
      now: 1_700_000_000_000,
    },
    { engine, templates: memoryTemplateReader([template]) },
  );
  if (!plan.ok) throw new Error(`planVariants: ${plan.error.code}`);
  return {
    label: {
      caseId: VARIANT_CASE_ID,
      synthetic: true,
      count: VARIANT_COUNT,
      acceptable: built.acceptable,
    },
    prediction: {
      caseId: VARIANT_CASE_ID,
      variants: plan.value.timelines.map((timeline) => rowOf(timeline)),
    },
  };
}

/** Predictions for CLI labels. Those labels carry no acceptable set, so pickAcceptance stays off. */
export async function predictVariants(labels: readonly VariantLabel[]): Promise<VariantPrediction[]> {
  requireSyntheticLabels('variants', labels, "the case's casting library and template (P2-Q2's)");
  const planned = await planHookVariants();
  return labels.map((label) => ({
    caseId: label.caseId,
    variants: planned.prediction.variants.slice(0, label.count),
  }));
}
