// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B8's agent tools: read a timeline's gaps (with each slot's intent) and the shot list, then fix a gap: fill
 * it with a still or a video, drop the slot, or mark slots the person will film. The agent proposes the fixes
 * on the gap-fix card; these make the one the person (or the agent's autonomy) chose, one undo step each.
 */
import {
  CAMERA_MOTIONS,
  CAST_NOTES,
  defineTool,
  DROP_MODES,
  ok,
  rationalTimeJsonSchema,
  SHOT_TYPES,
  STILL_MOTIONS,
  TIMELINE_COMMANDS,
  ulidSchema,
  type AnyTool,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineService } from '../service/service';
import { editCommandTool } from './edit-command-tool';

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };
const itemId = ulidSchema('TimelineItem');
const slotId = ulidSchema('TemplateSlot');

export const gapsToolOutputSchema = z.object({
  gaps: z.array(
    z.object({
      gapId: itemId,
      slotId: slotId.nullable(),
      number: z.int().positive(),
      startFrame: z.int().nonnegative(),
      frames: z.int().positive(),
      intent: z
        .object({
          text: z.string().max(500).meta({ untrusted: 'reference-text' }),
          shotType: z.enum(SHOT_TYPES).nullable(),
          motion: z.enum(CAMERA_MOTIONS).nullable(),
          energy: z.number().min(0).max(1),
        })
        .nullable(),
      note: z.enum(CAST_NOTES).nullable(),
    }),
  ),
});

export const fillGapToolInputSchema = z.object({
  ...target,
  gapId: itemId,
  media: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), assetId: ulidSchema('Asset'), stillMotion: z.enum(STILL_MOTIONS).default('pushIn') }),
    z.object({
      kind: z.literal('video'),
      assetId: ulidSchema('Asset'),
      shotId: ulidSchema('Shot').nullable(),
      sourceStart: rationalTimeJsonSchema.optional(),
    }),
  ]),
});

const WRITES = [
  {
    command: TIMELINE_COMMANDS.fillGap,
    input: fillGapToolInputSchema,
    description:
      "Fills one gap with a library still or video for the gap's whole length, in the same place, keeping its slot and beat. A still moves gently (stillMotion, default pushIn); a video's in-point follows the in-point rule unless you give sourceStart. Generated images and stock media are imported into the library first.",
    summary: "Fills one gap with a library still or video for the gap's whole length.",
    tags: ['gap', 'fill', 'still', 'cast'],
  },
  {
    command: TIMELINE_COMMANDS.dropSlot,
    input: z.object({ ...target, itemId, mode: z.enum(DROP_MODES).default('ripple') }),
    description:
      'Drops one slot (a clip or a gap). ripple: the video gets shorter, later cuts move earlier and stay on their beats, text and captions follow. extendPrevious: the clip before (else after) takes the time and nothing else moves.',
    summary: 'Drops one slot: ripple the video shorter, or let a neighbour cover it.',
    tags: ['gap', 'drop', 'ripple'],
  },
  {
    command: TIMELINE_COMMANDS.markForFilming,
    input: z.object({ ...target, slotIds: z.array(slotId).min(1).max(60), on: z.boolean() }),
    description:
      "Marks slots the person will film themselves (or unmarks them): they join the phone page's shot list with their intent, shot type, motion and length.",
    summary: "Marks slots the person will film; they join the phone's shot list.",
    tags: ['gap', 'film', 'shot-list', 'phone'],
  },
] as const;

export function gapTools(service: TimelineService): AnyTool[] {
  // No stock media in the fixes it names: the stock tools aren't on the agent loop (library SPEC, P3-V18), and a
  // model told to propose a fix it has no tool for promises the person something it can't do (review M7).
  const gaps = defineTool({
    name: 'timeline.gaps',
    version: '1.0.0',
    description:
      "Lists a timeline's empty slots: each gap's id, slot, number, place and length in frames, the slot's intent from the template, and its cast note. Propose a fix for every one: a still or video from the library, a generated image, filming it on the phone, or dropping the slot.",
    summary: "Lists a timeline's gaps with each slot's intent, to propose fixes.",
    tags: ['gap', 'read'],
    input: z.object({ timelineId: ulidSchema('Timeline') }),
    output: gapsToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, initialDelayMs: 200 },
    run: async (input) => {
      const found = service.gaps ? await service.gaps(input.timelineId) : ok([]);
      if (!found.ok) return found;
      return ok({
        gaps: found.value.map((gap) => ({
          gapId: gap.gapId,
          slotId: gap.slotId,
          number: gap.number,
          startFrame: gap.start.value,
          frames: gap.duration.value,
          intent: gap.intent,
          note: gap.note,
        })),
      });
    },
  });
  const writes = WRITES.map((write) => editCommandTool({ ...write, input: write.input as z.ZodType }));
  return [gaps as AnyTool, ...writes];
}
