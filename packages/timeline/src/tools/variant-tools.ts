// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V3's agent tool: 2–5 variants of a cut that differ in the hook, the music or the caption look, made in one
 * `timeline.create` so one ⌘Z removes the set. Ids and the variants' item ids come from the call's idempotency
 * key, so a retried call plans the same variants. The ids go on to render's `render.exportBatch`.
 */
import {
  CAPTION_PRESET_IDS,
  defineTool,
  DERIVED_KEY_PATTERN,
  err,
  musicChoiceSchema,
  NO_TOOL_RETRY,
  ok,
  rationalTimeJsonSchema,
  TIMELINE_COMMANDS,
  ulidSchema,
  ValidationError,
  VARIANT_AXES,
  type AnyTool,
  type MusicChoice,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import type { CastingEngine } from '../casting/engine';
import { derivedIds } from '../model/derived-ids';
import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { planVariants, VARIANT_COUNT } from '../variants/plan-variants';
import type { VariantMusicDeps } from '../variants/variant-deps';
import { toolKey } from './hash';
import { parseField } from './parse-field';

const gainDb = z.number().min(-60).max(12);

/** core's musicChoiceSchema as JSON Schema can carry it (ids as ULID strings, times as {value, rate}). */
const musicChoiceJson = z.discriminatedUnion('path', [
  z.object({ path: z.literal('none') }),
  z.object({ path: z.literal('platformSound') }),
  z.object({
    path: z.literal('ownTrack'),
    assetId: ulidSchema('Asset'),
    offset: rationalTimeJsonSchema,
    gainDb,
  }),
  z.object({ path: z.literal('referenceAudio'), templateId: ulidSchema('Template'), gainDb }),
  z.object({
    path: z.literal('generated'),
    assetId: ulidSchema('Asset'),
    warpedKey: z.string().regex(DERIVED_KEY_PATTERN),
    bpm: z.number().min(40).max(240),
    grid: z.object({
      maxErrorMs: z.number().nonnegative(),
      p95ErrorMs: z.number().nonnegative(),
      missed: z.number().min(0).max(1),
    }),
    gainDb,
  }),
]);

export const makeVariantsToolInputSchema = z.object({
  projectId: ulidSchema('Project'),
  baseTimelineId: ulidSchema('Timeline').describe('The cut the variants start from; it is left as it is'),
  count: z.int().min(VARIANT_COUNT.min).max(VARIANT_COUNT.max),
  axes: z
    .array(z.enum(VARIANT_AXES))
    .min(1)
    .max(VARIANT_AXES.length)
    .describe(
      'What the variants differ in: the hook (first 3 s and ≥ 30% of shots), the music, the caption look',
    ),
  music: z
    .array(musicChoiceJson)
    .max(10)
    .optional()
    .describe(
      "Music candidates for the music axis, best first; referenceAudio is the reel the base's template keeps",
    ),
  captionPresets: z
    .array(z.enum(CAPTION_PRESET_IDS))
    .min(1)
    .max(CAPTION_PRESET_IDS.length)
    .optional()
    .describe('Caption looks to try, best first; default: every preset'),
});

export const makeVariantsToolOutputSchema = z.object({
  castId: ulidSchema('Cast'),
  timelineIds: z.array(ulidSchema('Timeline')).max(VARIANT_COUNT.max),
  differences: z
    .array(
      z.object({
        timelineId: ulidSchema('Timeline'),
        hookChanged: z.boolean(),
        picksChanged: z.number().min(0).max(1).describe('Share of slots showing another shot than the base'),
        music: z
          .enum(['none', 'platformSound', 'ownTrack', 'referenceAudio', 'generated'])
          .nullable()
          .describe('null: as the base'),
        captionPreset: z.enum(CAPTION_PRESET_IDS).nullable().describe('null: as the base'),
      }),
    )
    .max(VARIANT_COUNT.max),
  variantsShort: z
    .object({ axis: z.enum(VARIANT_AXES), asked: z.int().min(1), made: z.int().min(0) })
    .optional()
    .describe('Fewer variants than asked: the axis whose candidates or library ran out'),
});

export interface VariantToolDeps {
  readonly engine: Pick<CastingEngine, 'hookVariants' | 'config'>;
  readonly service: Pick<TimelineService, 'read'>;
  readonly templates: TemplateReader;
  readonly clock: { now(): number };
  readonly music?: VariantMusicDeps;
}

function parseMusic(candidates: readonly unknown[] | undefined): Result<MusicChoice[] | undefined> {
  return candidates ? parseField(z.array(musicChoiceSchema), candidates, 'music') : ok(undefined);
}

export function variantTools(deps: VariantToolDeps): AnyTool[] {
  const make = defineTool({
    name: 'timeline.makeVariants',
    version: '1.1.0',
    description:
      "Makes 2–5 variants of a timeline for hook testing, in one undoable step: each differs from the base and from the others in the axes asked — the hook (another opening shot and at least 30% of shots changed, the user's locked and picked clips kept), the music (from the candidates given) or the caption look (a preset). The base is left as it is. Returns the new timeline ids and what each changed; render them all with render.exportBatch. Fewer than asked come back with variantsShort when the library or the candidates run out.",
    summary: 'Makes 2–5 hook, music or caption variants of a timeline in one undoable step.',
    tags: ['variants', 'hook', 'casting', 'music', 'captions'],
    input: makeVariantsToolInputSchema,
    output: makeVariantsToolOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: TIMELINE_COMMANDS.create,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.makeVariants', input),
    run: async (input, ctx) => {
      const music = parseMusic(input.music);
      if (!music.ok) return music;
      const base = await deps.service.read(input.baseTimelineId);
      if (!base.ok) return base;
      if (base.value.projectId !== input.projectId) return err(ValidationError({ field: 'projectId' }));
      const seed = ctx.idempotencyKey ?? toolKey('timeline.makeVariants', input);
      const now = deps.clock.now();
      const timelineIds = derivedIds<'Timeline'>(`${seed}:timelines`, now);
      const plan = await planVariants(
        {
          base: base.value,
          count: input.count,
          axes: input.axes,
          ...(music.value ? { music: music.value } : {}),
          ...(input.captionPresets ? { captionPresets: input.captionPresets } : {}),
          timelineIds: Array.from({ length: input.count }, () => timelineIds()),
          castId: derivedIds<'Cast'>(`${seed}:cast`, now)(),
          seed,
          now,
        },
        {
          engine: deps.engine,
          templates: deps.templates,
          signal: ctx.signal,
          ...(deps.music ? { music: deps.music } : {}),
        },
      );
      if (!plan.ok) return plan;
      const created = await ctx.dispatch({ projectId: input.projectId, timelines: plan.value.timelines });
      if (!created.ok) return created;
      return ok({
        castId: plan.value.castId,
        timelineIds: plan.value.timelines.map((timeline) => timeline.id),
        differences: plan.value.differences.map((difference) => ({
          ...difference,
          music: difference.music?.path ?? null,
        })),
        ...(plan.value.variantsShort ? { variantsShort: plan.value.variantsShort } : {}),
      });
    },
  });
  return [make as AnyTool];
}
