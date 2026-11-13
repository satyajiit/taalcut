// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Planted gaps for the gaps tests (P3-B8): a GapSource over the flow world's timelines (each timeline the
 * Librarian casts gets the planted slots), and stand-in tools shaped like the timeline, images, library and
 * voice lanes' (they import only core and zod). Every write moves the timeline's revision like the store.
 */
import {
  defineTool,
  defineToolModule,
  FrameRates,
  newId,
  NO_TOOL_RETRY,
  ok,
  RationalTime,
  ULID_PATTERN,
  type AnyTool,
  type ToolModule,
} from '@taalcut/core';
import type {
  GapOffers,
  GapShot,
  GapSlot,
  GapSlotState,
  GapSource,
  GapTimeline,
  WeakPickInfo,
} from '@taalcut/agent';
import { z } from 'zod';
import { flowToolModules, userEdit, type World } from '../support/flow-world';

/**
 * Each slot's state as the Librarian leaves it; slot 1 is the hook. FIX-GAPS: `weak` is an unsure pick no other
 * clip beats; `weakBetter` one whose first candidate clearly fits better.
 */
export type Planted = 'ok' | 'empty' | 'weak' | 'weakBetter';

export interface GapWorld {
  readonly world: World;
  /** The planted slots of every cast timeline (default: slot 2 empty, slot 4 weak). */
  plan: Planted[];
  readonly slots: Map<string, (GapSlot & { readonly planted: Planted })[]>;
  /** The format's minimum, in seconds (null: none). */
  minSeconds: number | null;
  readonly source: GapSource;
  readonly calls: string[];
  /** A fix tool "succeeds" without changing the stored slot (to test the second method). */
  lie: boolean;
  /** FIX-ASK: the offers an open slot gets when the reader is asked for them (by the slots as stored now). */
  offers?: (slot: GapSlot, all: readonly GapSlot[]) => GapOffers | undefined;
  /** FIX-ASK: what each read lists as the template's text or graphics, by slot number. */
  carries?: ReadonlyMap<number, readonly ('text' | 'graphics')[]>;
}

const fps = FrameRates.fps30;
const SLOT_FRAMES = 90;
const ulid = z.string().regex(ULID_PATTERN);
const local = { costClass: 'local' as const, timeoutMs: 2_000, retry: NO_TOOL_RETRY };

const INTENTS = [
  'A wide shot of the beach at sunrise',
  'A drone shot over the bay',
  'Feet in the sand',
  'Sunset close-up',
];

export const shot = (description: string, fit: number): GapShot => ({
  assetId: newId<'Asset'>(),
  shotId: newId<'Shot'>(),
  description,
  fit,
});

/** FIX-GAPS: a planted weak pick: the clip, two candidates best fit first, and the better one when planted. */
export function plantedWeak(better: boolean): WeakPickInfo {
  const candidates = better
    ? [shot('A person walks away down a lit street at night', 0.86), shot('A quiet street at dusk', 0.5)]
    : [shot('A kitchen in daylight', 0.3), shot('A dog on a beach', 0.2)];
  return {
    pick: shot('A person talks to the camera on a sunny beach', 0.35),
    confidence: 0.2,
    candidates,
    better: better ? candidates[0]! : null,
  };
}

function plantedSlots(plan: readonly Planted[]) {
  return plan.map((planted, index) => {
    // A slot casting is sure of is listed as picked, with its clip, as the desktop's reader lists it (FIX-GAPS).
    const state: GapSlotState = planted === 'ok' ? 'picked' : planted === 'empty' ? 'empty' : 'weak';
    const sure = planted === 'ok' ? { current: { assetId: newId<'Asset'>(), shotId: newId<'Shot'>() } } : {};
    const weak =
      planted === 'weak' || planted === 'weakBetter' ? plantedWeak(planted === 'weakBetter') : null;
    return {
      gapId: newId<'TimelineItem'>(),
      slotId: newId<'TemplateSlot'>(),
      number: index + 1,
      start: RationalTime.of(index * SLOT_FRAMES, fps),
      duration: RationalTime.of(SLOT_FRAMES, fps),
      intent: {
        text: INTENTS[index % INTENTS.length] ?? 'A shot',
        shotType: 'wide' as const,
        motion: 'pan' as const,
        energy: 0.5,
      },
      state,
      note: null,
      planted,
      ...sure,
      ...(weak ? { weak, current: { assetId: weak.pick.assetId, shotId: weak.pick.shotId } } : {}),
    };
  });
}

export function createGapWorld(world: World, plan: Planted[] = ['ok', 'empty', 'ok', 'weak']): GapWorld {
  const slots = new Map<string, (GapSlot & { readonly planted: Planted })[]>();
  const gaps: GapWorld = {
    world,
    plan,
    slots,
    minSeconds: null,
    calls: [],
    lie: false,
    source: {
      async read(timelineId, _signal, options) {
        const own = slots.get(timelineId) ?? plantedSlots(gaps.plan);
        slots.set(timelineId, own);
        const live = own.filter((s) => s.state !== 'dropped');
        const frames = live.length * SLOT_FRAMES;
        const listed = own.map((slot) => {
          const carries = gaps.carries?.get(slot.number);
          const open = slot.state === 'empty' || slot.state === 'weak';
          const offers = options?.offers && open ? gaps.offers?.(slot, own) : undefined;
          return { ...slot, ...(carries ? { carries } : {}), ...(offers ? { offers } : {}) };
        });
        const timeline: GapTimeline = {
          timelineId,
          projectId: world.projectId,
          revision: world.timelines.get(timelineId) ?? 1,
          duration: RationalTime.of(frames, fps),
          minDuration: gaps.minSeconds === null ? null : RationalTime.fromSeconds(gaps.minSeconds, fps),
          slots: listed,
          slotCount: live.length,
        };
        return ok(timeline);
      },
    },
  };
  return gaps;
}

/** Applies a fix to the stored slot (unless the world is set to lie) and moves the timeline on. */
function touch(
  gaps: GapWorld,
  timelineId: string,
  match: (s: GapSlot) => boolean,
  change: Partial<GapSlot>,
  drop: readonly (keyof GapSlot)[] = [],
) {
  const own = gaps.slots.get(timelineId) ?? [];
  const index = own.findIndex(match);
  const slot = own[index];
  if (slot && !gaps.lie) {
    const next: Record<string, unknown> = { ...slot, ...change };
    for (const key of drop) delete next[key];
    own[index] = next as unknown as (typeof own)[number];
  }
  return userEdit(gaps.world, timelineId);
}

const write = (name: string, command: string) => ({ sideEffect: 'write' as const, command, name, ...local });

function gapTools(gaps: GapWorld): AnyTool[] {
  return [
    defineTool({
      ...write('timeline.dropSlot', 'timeline.dropSlot'),
      version: '1.0.0',
      description: 'Drops a slot (a clip or a gap); its neighbours take the time on the beat grid. Undoable.',
      input: z.object({ timelineId: ulid, itemId: z.string() }),
      output: z.object({ timelineId: ulid, revision: z.int() }),
      idempotencyKey: (input) => `drop:${input.timelineId}:${input.itemId}`,
      run: async (input, ctx) => {
        const done = await ctx.dispatch(input);
        if (!done.ok) return done;
        gaps.calls.push('timeline.dropSlot');
        const revision = touch(gaps, input.timelineId, (s) => s.gapId === input.itemId, {
          state: 'dropped',
          note: 'dropped',
        });
        return ok({ timelineId: input.timelineId, revision });
      },
    }),
    defineTool({
      ...write('timeline.markForFilming', 'timeline.markForFilming'),
      version: '1.0.0',
      description: 'Puts slots on the "film this" list the phone shows. Undoable.',
      input: z.object({
        timelineId: ulid,
        slotIds: z.array(z.string()).min(1),
        on: z.boolean().default(true),
      }),
      output: z.object({ timelineId: ulid, revision: z.int() }),
      idempotencyKey: (input) => `film:${input.timelineId}:${input.slotIds.join(',')}`,
      run: async (input, ctx) => {
        const done = await ctx.dispatch(input);
        if (!done.ok) return done;
        gaps.calls.push('timeline.markForFilming');
        const revision = touch(gaps, input.timelineId, (s) => input.slotIds.includes(s.slotId ?? ''), {
          note: 'filmRequested',
        });
        return ok({ timelineId: input.timelineId, revision });
      },
    }),
    defineTool({
      ...write('timeline.swapClip', 'timeline.swapClip'),
      version: '1.0.0',
      description: "Swaps a clip's media for another shot in the same place. Undoable.",
      input: z.object({
        timelineId: ulid,
        clipId: z.string(),
        media: z.object({ assetId: z.string(), shotId: z.string().nullable() }),
        sourceStart: z.object({ value: z.int(), rate: z.object({ num: z.int(), den: z.int() }) }).optional(),
        from: z.enum(['alternate', 'search', 'agent']),
      }),
      output: z.object({ timelineId: ulid, revision: z.int() }),
      idempotencyKey: (input) => `swap:${input.timelineId}:${input.clipId}:${input.media.assetId}`,
      run: async (input, ctx) => {
        const done = await ctx.dispatch(input);
        if (!done.ok) return done;
        gaps.calls.push('timeline.swapClip');
        // The swapped-in clip comes from casting's pick list by the agent: no longer unsure.
        const revision = touch(
          gaps,
          input.timelineId,
          (s) => s.gapId === input.clipId,
          { state: 'picked', current: input.media },
          ['weak'],
        );
        return ok({ timelineId: input.timelineId, revision });
      },
    }),
    defineTool({
      ...write('timeline.fillGap', 'timeline.fillGap'),
      version: '1.0.0',
      description: 'Fills a gap with an image or a video. Undoable.',
      input: z.object({
        timelineId: ulid,
        gapId: z.string(),
        assetId: z.string().optional(),
        media: z
          .object({
            kind: z.enum(['image', 'video']),
            assetId: z.string(),
            shotId: z.string().nullable().optional(),
            sourceStart: z.unknown().optional(),
          })
          .optional(),
      }),
      output: z.object({ timelineId: ulid, revision: z.int() }),
      idempotencyKey: (input) => `fill:${input.timelineId}:${input.gapId}`,
      run: async (input, ctx) => {
        const done = await ctx.dispatch(input);
        if (!done.ok) return done;
        gaps.calls.push('timeline.fillGap');
        const media = input.media
          ? { current: { assetId: input.media.assetId, shotId: input.media.shotId ?? null } }
          : {};
        const revision = touch(gaps, input.timelineId, (s) => s.gapId === input.gapId, {
          state: 'filled',
          note: 'gapFilled',
          ...media,
        });
        return ok({ timelineId: input.timelineId, revision });
      },
    }),
  ];
}

/** The paid image tool, as models declares it: it places the still in the slot's gap. */
export function imagesModule(gaps: GapWorld, usd = 0.04): ToolModule {
  return defineToolModule({
    id: 'images',
    tools: [
      defineTool({
        name: 'images.generateForSlot',
        version: '1.0.0',
        description: 'Generates a still for one slot from a prompt and places it there.',
        input: z.object({ projectId: ulid, timelineId: ulid, slotId: z.string(), prompt: z.string().min(1) }),
        output: z.object({ timelineId: ulid, placed: z.string(), costUsd: z.number(), revision: z.int() }),
        costClass: 'paid',
        sideEffect: 'write',
        command: 'timeline.fillGap',
        timeoutMs: 2_000,
        retry: NO_TOOL_RETRY,
        permission: { network: 'internet', cloudModules: ['images'] },
        estimateCost: () => ({ usd, tokens: 0 }),
        idempotencyKey: (input) => `image:${input.timelineId}:${input.slotId}:${input.prompt}`,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          if (!done.ok) return done;
          gaps.calls.push('images.generateForSlot');
          ctx.reportUsage({ usd, inputTokens: 0, outputTokens: 0 });
          const revision = touch(gaps, input.timelineId, (s) => s.slotId === input.slotId, {
            state: 'filled',
            note: 'gapFilled',
          });
          return ok({ timelineId: input.timelineId, placed: newId<'Asset'>(), costUsd: usd, revision });
        },
      }),
    ],
  });
}

/** The flow world's tool modules with the gap tools added to its timeline module. */
export function gapToolModules(gaps: GapWorld, extra: readonly ToolModule[] = []): ToolModule[] {
  return [
    ...flowToolModules(gaps.world).map((module) =>
      module.id === 'timeline'
        ? defineToolModule({ id: 'timeline', tools: [...module.tools, ...gapTools(gaps)] })
        : module,
    ),
    ...extra,
  ];
}

/** The stand-in stock search (P3-V18, the library's stock module), added when a test ships stock. */
export function withStockSearch(modules: ToolModule[]): ToolModule[] {
  const search = defineTool({
    name: 'stock.search',
    version: '1.0.0',
    description: 'Searches stock footage (Pexels) for a gap.',
    input: z.object({ query: z.string().min(1) }),
    output: z.object({ results: z.array(z.object({ id: z.string() })) }),
    sideEffect: 'read',
    ...local,
    run: async () => ok({ results: [{ id: 'pexels-1' }] }),
  });
  return [...modules, defineToolModule({ id: 'stock', tools: [search] })];
}
