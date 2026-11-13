// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sound effects on cuts (SPEC P3.6, P3.9): `sfx.addHits` plans hits from the bundled CC0 pack (local) and
 * `sfx.generateHit` asks the sound-effect provider for one new sound and puts it on chosen cuts (paid). Both
 * replace the effects track with one `sfx.setHits`, so one undo takes the hits off again.
 *
 * EAR1-D3, `sfx.addHits` 2.0: it also takes bank sounds by id (`soundIds`, each take's apex on its cut) and a kit (a
 * preset's name or a kit file; `roles` says which role serves which cut kind). A version 1 input plans from the v1
 * pack exactly as before; the idempotency key is the input's hash, so it covers the kit and the sound ids.
 *
 * EAR1-G1: `fromTemplate` puts the effects the template's reference reel had on its cuts on the same cuts (the
 * breakdown's `audio.listening.sfxAtCuts`, as bank sounds). Audio can't read templates, so the desktop injects
 * `templateHits` (templates' reelSfxPayload over the timeline's template and the `sfx-bank` component).
 */
import {
  defineTool,
  defineToolModule,
  err,
  MIX_COMMANDS,
  NO_TOOL_RETRY,
  ok,
  sfxKitRoleSchema,
  ulidSchema,
  type AsyncResult,
  type CommandToolContext,
  type mixCommandPayloads,
  type Timeline,
  type TimelineStore,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { readTimeline } from '../commands/timeline-writes';
import { ReelSfxUnavailable } from '../listen/errors';
import { HIT_DENSITIES, HIT_STYLES } from '../sfx/hit-plan';
import { KIT_PRESETS } from '../sfx/kits/presets';
import { kitSchema } from '../sfx/kits/schema';
import type { createSfxService, HitsOutcome } from '../sfx/hits-service';
import { ESTIMATE_BOUNDS, sfxEstimate, type GenerationPrices } from './prices';
import { inputKey } from './tool-keys';

/** What `sfx.setHits` takes (each path's payload; the planners' also carry the revision they read). */
type SetHitsPayload = z.output<(typeof mixCommandPayloads)[typeof MIX_COMMANDS.setHits]>;
type Outcome = Pick<HitsOutcome, 'costUsd'> & { readonly payload: SetHitsPayload };

export interface SfxToolDeps {
  readonly service: Pick<ReturnType<typeof createSfxService>, 'addHits' | 'generateHit'>;
  readonly timelines: TimelineStore;
  readonly prices: GenerationPrices;
  /**
   * EAR1-G1: the template's reel effects on the timeline's cuts (`fromTemplate`), as one `sfx.setHits` payload; its
   * errors say why there are none (`audio.reel_sfx_unavailable`). Absent where no template store is: refused.
   */
  readonly templateHits?: (timeline: Timeline, signal: AbortSignal) => AsyncResult<SetHitsPayload>;
}

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };

/** A bank sound: Taalcut's id ('cut_hit/sub', 'fit/tick_domino') or earshot's ('fit/tick/domino'). */
const soundIdSchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9_]*(?:\/[a-z0-9_.]+){1,2}$/);

const addHitsInput = z
  .object({
    ...target,
    density: z.enum(HIT_DENSITIES).default('downbeats'),
    style: z.enum(HIT_STYLES).optional(),
    soundIds: z.array(soundIdSchema).min(1).max(20).optional(),
    kit: z.union([z.enum(KIT_PRESETS), kitSchema]).optional(),
    roles: z
      .object({
        whoosh: sfxKitRoleSchema.optional(),
        riser: sfxKitRoleSchema.optional(),
        impact: sfxKitRoleSchema.optional(),
        hit: sfxKitRoleSchema.optional(),
      })
      .optional(),
    fromTemplate: z.boolean().optional(),
  })
  .refine(
    (input) =>
      !input.fromTemplate ||
      (input.soundIds === undefined && input.kit === undefined && input.roles === undefined),
    { message: 'fromTemplate places the reel’s own effects: leave out soundIds, kit and roles' },
  )
  // EAR1-R2: roles names a kit's roles; without a kit it would be ignored.
  .refine((input) => input.roles === undefined || input.kit !== undefined, {
    message: 'roles picks which of a kit’s roles serves each cut kind: give kit too',
    path: ['roles'],
  });

/** EAR1-G1: the reel's own effects, from the desktop's templateHits; bank sounds, so nothing to pay. */
async function reelHits(deps: SfxToolDeps, timeline: Timeline, signal: AbortSignal): AsyncResult<Outcome> {
  if (!deps.templateHits)
    return err(ReelSfxUnavailable({ reason: 'other' }, { detail: 'no template store in this process' }));
  const payload = await deps.templateHits(timeline, signal);
  return payload.ok ? ok({ payload: payload.value, costUsd: 0 }) : payload;
}

async function apply(ctx: CommandToolContext, made: Outcome) {
  if (made.costUsd > 0) ctx.reportUsage({ usd: made.costUsd });
  return ctx.dispatch(made.payload);
}

function addHitsTool(deps: SfxToolDeps) {
  return defineTool({
    name: 'sfx.addHits',
    version: '2.0.0',
    description:
      "Puts sound effects on the timeline's cuts: whooshes on whip pans and slides, a riser and impact on " +
      'zooms, an impact on flashes, a subtle hit on hard cuts on downbeats. density: everyCut, downbeats ' +
      '(default) or hookOnly (first 3 s); style punchy also hits cuts inside spoken lines. Without soundIds or ' +
      "kit it uses Taalcut's CC0 pack. soundIds: SFX bank sounds (from sfx.searchSounds) for their kinds of cut, " +
      'each loudest moment on its cut. kit: calm, crisp, minimal or launch (or a kit file); with a kit, roles ' +
      'maps a cut kind (whoosh, riser, impact, hit) to a kit role (default whoosh.short, riser, hit, land). ' +
      "fromTemplate: the effects the template's reference reel had on the same cuts (without soundIds, kit or " +
      'roles). Replaces the effects already there; with soundIds or a kit that fit no cut it fails and changes ' +
      'nothing. Undoable.',
    summary: "Puts sound effects on the timeline's cuts (CC0 pack, bank sounds or a kit).",
    tags: ['sfx', 'sound-effects', 'whoosh', 'cuts', 'kit'],
    input: addHitsInput,
    output: z.object({ hits: z.int().nonnegative() }),
    costClass: 'local',
    sideEffect: 'write',
    command: MIX_COMMANDS.setHits,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => inputKey('sfx.addHits', input),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const made = input.fromTemplate
        ? await reelHits(deps, timeline.value, ctx.signal)
        : await deps.service.addHits({
            timeline: timeline.value,
            density: input.density,
            ...(input.style ? { style: input.style } : {}),
            ...(input.soundIds ? { soundIds: input.soundIds } : {}),
            ...(input.kit !== undefined ? { kit: input.kit } : {}),
            ...(input.roles ? { roles: input.roles } : {}),
            signal: ctx.signal,
          });
      if (!made.ok) return made;
      const done = await apply(ctx, made.value);
      return done.ok ? ok({ hits: made.value.payload.hits.length }) : done;
    },
  });
}

function generateHitTool(deps: SfxToolDeps) {
  return defineTool({
    name: 'sfx.generateHit',
    version: '1.0.0',
    description:
      'Generates one new sound effect from a short description (no names of films, games or brands) and puts ' +
      'it on the given cuts (their indexes, first cut 0), its peak on each cut, next to the hits already there. ' +
      'Paid. Undoable.',
    summary: 'Generates one new sound effect and puts it on chosen cuts.',
    tags: ['sfx', 'sound-effects', 'generate'],
    input: z.object({
      ...target,
      prompt: z.string().min(1).max(200),
      cutIndexes: z.array(z.int().nonnegative()).min(1).max(20),
    }),
    output: z.object({ assetId: z.string(), hits: z.int().nonnegative(), costUsd: z.number().nonnegative() }),
    costClass: 'paid',
    sideEffect: 'write',
    command: MIX_COMMANDS.setHits,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', cloudModules: ['music'] },
    idempotencyKey: (input) => inputKey('sfx.generateHit', input),
    estimateCost: () =>
      sfxEstimate(
        deps.prices,
        ESTIMATE_BOUNDS.hitSeconds,
        `one ${ESTIMATE_BOUNDS.hitSeconds} s sound at the list price`,
      ),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const made = await deps.service.generateHit({
        timeline: timeline.value,
        prompt: input.prompt,
        cutIndexes: input.cutIndexes,
        signal: ctx.signal,
        trace: { ...(ctx.runId ? { runId: ctx.runId } : {}), projectId: timeline.value.projectId },
      });
      if (!made.ok) return made;
      const done = await apply(ctx, made.value);
      if (!done.ok) return done;
      return ok({
        assetId: made.value.assetId,
        hits: made.value.payload.hits.length,
        costUsd: made.value.costUsd,
      });
    },
  });
}

/** The `sfx` module. */
export function sfxToolModule(deps: SfxToolDeps): ToolModule {
  return defineToolModule({ id: 'sfx', tools: [addHitsTool(deps), generateHitTool(deps)] });
}
