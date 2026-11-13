// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V12's agent tools: plan an energy curve on a timeline (which slots it re-splits and the shots it would cast
 * for them) and apply the plan in one undo step. The plan, with its curve, is stored as an artifact and applied
 * by its id, so the model never copies the picks back.
 */
import {
  artifactRefSchema,
  BEATS_PER_CLIP,
  ENERGY_ALIGN,
  energyCurvePlanSchema,
  energyCurveSchema,
  err,
  NotImplementedError,
  ok,
  TIMELINE_COMMANDS,
  ulidSchema,
  type AnyTool,
  type AsyncResult,
  type TimelineId,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineService } from '../service/service';
import { parseField } from './parse-field';
import { appliedPlanInputSchema, applyPlanTool, planTool, type MadePlan } from './planned-edit';

const curveJson = z.object({
  sections: z
    .array(
      z.object({
        fromSlotId: ulidSchema('TemplateSlot'),
        toSlotId: ulidSchema('TemplateSlot'),
        energy: z.number().min(0).max(1),
        beatsPerClip: z.literal(BEATS_PER_CLIP).describe('Beats each clip lasts: fewer is faster cutting'),
        align: z.enum(ENERGY_ALIGN),
      }),
    )
    .min(1)
    .max(200)
    .describe("Runs of consecutive template slots, in order, covering every slot of the timeline's template"),
});

const planInputSchema = z.object({ timelineId: ulidSchema('Timeline'), curve: curveJson });

const planOutputSchema = z.object({
  templateBaseVersion: z.int().min(1),
  changedSlots: z.int().nonnegative(),
  recast: z.int().nonnegative().describe('Changed slots the library gave a shot for; the rest become gaps'),
  cuts: z.array(z.int().nonnegative()).max(201).describe('The new cut positions, canvas frames'),
  plan: artifactRefSchema,
});

/** What the plan tool keeps: the curve with its plan, so applying needs only the artifact id. */
const keptPlanSchema = z.object({ curve: energyCurveSchema, plan: energyCurvePlanSchema });

/** The energy plan for one timeline, kept with its curve; `core.not_implemented` until the curve is wired. */
async function makeEnergyPlan(
  service: TimelineService,
  timelineId: TimelineId,
  input: z.output<typeof curveJson>,
): AsyncResult<MadePlan<z.input<typeof planOutputSchema>>> {
  if (!service.planEnergyCurve) return err(NotImplementedError({ feature: 'timelines.planEnergyCurve' }));
  // The model's curve against core's full schema: it covers rules JSON Schema can't say.
  const curve = parseField(energyCurveSchema, input, 'curve');
  if (!curve.ok) return curve;
  const made = await service.planEnergyCurve(timelineId, curve.value);
  if (!made.ok) return made;
  const { templateBaseVersion, changedSlots, picks, cuts } = made.value;
  return ok({
    kept: { curve: curve.value, plan: made.value },
    note: `Energy plan: ${changedSlots} slot(s) change on template version ${templateBaseVersion}.`,
    answer: (ref) => ({ templateBaseVersion, changedSlots, recast: picks.length, cuts, plan: ref }),
  });
}

export function energyTools(service: TimelineService): AnyTool[] {
  const plan = planTool({
    name: 'timeline.planEnergyCurve',
    description:
      'Plans an energy-curve change on a timeline made from a template: each section of slots gets a pace in beats per clip, faster sections split into more, shorter slots and slower ones merge. Only the changed slots are re-cast (the others keep their clips). Changes nothing; returns the new cuts and how many slots change, with the plan as an artifact to apply with timeline.applyEnergyCurve.',
    summary: 'Plans re-pacing a timeline by energy section. Changes nothing.',
    tags: ['energy', 'pacing', 'template', 'read'],
    input: planInputSchema,
    output: planOutputSchema,
    timeoutMs: 30_000,
    make: (input) => makeEnergyPlan(service, input.timelineId, input.curve),
  });

  const apply = applyPlanTool({
    service,
    command: TIMELINE_COMMANDS.applyEnergyCurve,
    description:
      "Applies an energy plan from timeline.planEnergyCurve in one undo step: a new template version with the new pace, and the timeline re-timed and re-cast on the changed slots. Refused when the timeline's template changed since the plan, or when it would change a clip the user locked.",
    summary: 'Applies an energy plan in one undo step.',
    tags: ['energy', 'pacing', 'template'],
    input: appliedPlanInputSchema('timeline.planEnergyCurve'),
    kept: keptPlanSchema,
    payload: (input, kept) => ({
      projectId: input.projectId,
      timelineId: input.timelineId,
      templateBaseVersion: kept.value.plan.templateBaseVersion,
      curve: kept.value.curve,
      picks: kept.value.plan.picks,
    }),
  });

  return [plan, apply];
}
