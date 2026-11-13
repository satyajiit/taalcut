// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.timelines: read-only, served by the agent process from
 * @taalcut/timeline's service; edits are TIMELINE_COMMANDS. The editor, the
 * cast board and the timeline card follow a document with `watch`, so a swap
 * from the board or ⌘Z shows up without a new card. P3's reads (pro export
 * formats, gaps and the shot list, cleanup and energy-curve plans) are
 * optional on the service until @taalcut/timeline implements them; the
 * router answers core.not_implemented meanwhile.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type ProjectId, type TimelineId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { eventIterator, implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { callOptional } from '../ipc/not-served';
import { rationalTimeSchema } from '../time/rational-time';
import { energyCurveSchema, energySlotMapSchema, type EnergyCurve } from '../templates/energy-curve';
import { CAMERA_MOTIONS, SHOT_TYPES } from '../templates/template-parts';
import { templateRefSchema } from '../templates/template-schema';
import { CAST_NOTES, castCandidateSchema, type CastCandidate } from './cast-schema';
import { cleanupPlanSchema, cleanupSettingsSchema, type CleanupPlan, type CleanupSettings } from './cleanup';
import { interchangeFormatSchema, type InterchangeFormatInfo } from './interchange';
import { timelineTranscriptSchema, type TimelineTranscript } from './simple-editor';
import { timelineSchema, type Timeline } from './timeline-schema';
import {
  fitTemplatesInputSchema,
  fitTemplatesResultSchema,
  type FitTemplatesInput,
  type FitTemplatesResult,
} from './template-fit';

export const timelineSummarySchema = z.object({
  id: idSchema<'Timeline'>(),
  projectId: idSchema<'Project'>(),
  name: z.string().min(1).max(200),
  revision: z.int().min(1),
  duration: rationalTimeSchema,
  clipCount: z.int().nonnegative(),
  template: templateRefSchema.nullable(),
  castId: idSchema<'Cast'>().nullable(),
  variantIndex: z.int().min(0).max(9).nullable(),
  updatedAt: z.int().nonnegative(),
});
export type TimelineSummary = z.output<typeof timelineSummarySchema>;

export const findAlternatesInputSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  slotId: idSchema<'TemplateSlot'>(),
  exclude: z.array(idSchema<'Shot'>()).max(200).default([]),
  limit: z.int().min(1).max(12).default(6),
});
export type FindAlternatesInput = z.output<typeof findAlternatesInputSchema>;

const timelineId = idSchema<'Timeline'>();
const slotPick = z.object({ slotId: idSchema<'TemplateSlot'>(), pick: castCandidateSchema });

/** A gap on V1 with the slot it was meant for (P3-B8). */
export const gapViewSchema = z.object({
  gapId: idSchema<'TimelineItem'>(),
  slotId: idSchema<'TemplateSlot'>().nullable(),
  /** 1-based, as the cast board numbers slots. */
  number: z.int().positive(),
  start: rationalTimeSchema,
  duration: rationalTimeSchema,
  intent: z
    .object({
      /** Plain text. */
      text: z.string().max(500),
      shotType: z.enum(SHOT_TYPES).nullable(),
      motion: z.enum(CAMERA_MOTIONS).nullable(),
      energy: z.number().min(0).max(1),
    })
    .nullable(),
  note: z.enum(CAST_NOTES).nullable(),
});
export type GapView = z.output<typeof gapViewSchema>;

/** One shot to film on the phone (P3-B8): the gaps and the slots marked filmRequested. */
export const shotListItemSchema = z.object({
  slotId: idSchema<'TemplateSlot'>().nullable(),
  number: z.int().positive(),
  /** Plain text: the intent in words. */
  what: z.string().max(500),
  shotType: z.enum(SHOT_TYPES).nullable(),
  motion: z.enum(CAMERA_MOTIONS).nullable(),
  seconds: z.number().positive(),
  orientation: z.enum(['portrait', 'landscape', 'square']),
});
export type ShotListItem = z.output<typeof shotListItemSchema>;

/** `timelines.planEnergyCurve`'s answer: what `timeline.applyEnergyCurve` would do. */
export const energyCurvePlanSchema = z.object({
  templateBaseVersion: z.int().min(1),
  slotMap: energySlotMapSchema,
  changedSlots: z.int().nonnegative(),
  picks: z.array(slotPick).max(200),
  /** The new cut positions in canvas frames, for the editor's ghost ticks. */
  cuts: z.array(z.int().nonnegative()).max(201),
});
export type EnergyCurvePlan = z.output<typeof energyCurvePlanSchema>;

export const timelinesContract = {
  transcript: ipc.input(z.object({ timelineId })).output(timelineTranscriptSchema),
  listByProject: ipc
    .input(z.object({ projectId: idSchema<'Project'>() }))
    .output(z.array(timelineSummarySchema)),
  get: ipc.input(z.object({ timelineId: idSchema<'Timeline'>() })).output(timelineSchema),
  /** The current document first, then every new revision. */
  watch: ipc.input(z.object({ timelineId: idSchema<'Timeline'>() })).output(eventIterator(timelineSchema)),
  /** "Find something else" on the cast board: fresh candidates for one slot, given its neighbours. */
  findAlternates: ipc.input(findAlternatesInputSchema).output(z.array(castCandidateSchema)),
  /** P3-V5: the pro export formats this build writes. */
  interchangeFormats: ipc.output(z.array(interchangeFormatSchema)),
  gaps: ipc.input(z.object({ timelineId })).output(z.array(gapViewSchema)),
  shotList: ipc.input(z.object({ timelineId })).output(z.array(shotListItemSchema)),
  /** P3-V9: a cleanup plan for these settings (default: CLEANUP_SETTING). Reads only. */
  planCleanup: ipc
    .input(z.object({ timelineId, settings: cleanupSettingsSchema.partial().optional() }))
    .output(cleanupPlanSchema),
  /** P3-V12: what an energy curve would do to this timeline. Reads only. */
  planEnergyCurve: ipc
    .input(z.object({ timelineId, curve: energyCurveSchema }))
    .output(
      energyCurvePlanSchema,
    ) /** LRN1-TPL: the templates that fit a pool of footage, best first. Reads only. */,
  fitTemplates: ipc.input(fitTemplatesInputSchema).output(fitTemplatesResultSchema),
};

/** What the agent process serves appContract.timelines from (@taalcut/timeline's service). */
export interface TimelinesService {
  transcript?(timelineId: TimelineId): AsyncResult<TimelineTranscript>;
  listByProject(projectId: ProjectId): AsyncResult<TimelineSummary[]>;
  get(timelineId: TimelineId): AsyncResult<Timeline>;
  /** Throws a TaalcutError (e.g. timeline.not_found) to end the stream. */
  watch(timelineId: TimelineId, signal: AbortSignal): AsyncIterable<Timeline>;
  findAlternates(input: FindAlternatesInput): AsyncResult<CastCandidate[]>;
  interchangeFormats?(): AsyncResult<InterchangeFormatInfo[]>;
  gaps?(timelineId: TimelineId): AsyncResult<GapView[]>;
  shotList?(timelineId: TimelineId): AsyncResult<ShotListItem[]>;
  planCleanup?(timelineId: TimelineId, settings?: Partial<CleanupSettings>): AsyncResult<CleanupPlan>;
  planEnergyCurve?(timelineId: TimelineId, curve: EnergyCurve): AsyncResult<EnergyCurvePlan>;
  fitTemplates?(input: FitTemplatesInput): AsyncResult<FitTemplatesResult>;
}

const never = new AbortController().signal;

export function timelinesRouter(service: TimelinesService) {
  const os = implementContract(timelinesContract);
  return os.router({
    listByProject: os.listByProject.handler(async ({ input }) =>
      unwrapRpc(await service.listByProject(input.projectId)),
    ),
    transcript: os.transcript.handler(({ input }) =>
      callOptional('timelines.transcript', service.transcript?.bind(service), input.timelineId),
    ),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input.timelineId))),
    watch: os.watch.handler(async function* ({ input, signal }) {
      yield* service.watch(input.timelineId, signal ?? never);
    }),
    findAlternates: os.findAlternates.handler(async ({ input }) =>
      unwrapRpc(await service.findAlternates(input)),
    ),
    interchangeFormats: os.interchangeFormats.handler(() =>
      callOptional('timelines.interchangeFormats', service.interchangeFormats?.bind(service)),
    ),
    gaps: os.gaps.handler(({ input }) =>
      callOptional('timelines.gaps', service.gaps?.bind(service), input.timelineId),
    ),
    shotList: os.shotList.handler(({ input }) =>
      callOptional('timelines.shotList', service.shotList?.bind(service), input.timelineId),
    ),
    planCleanup: os.planCleanup.handler(({ input }) =>
      callOptional(
        'timelines.planCleanup',
        service.planCleanup?.bind(service),
        input.timelineId,
        input.settings,
      ),
    ),
    planEnergyCurve: os.planEnergyCurve.handler(({ input }) =>
      callOptional(
        'timelines.planEnergyCurve',
        service.planEnergyCurve?.bind(service),
        input.timelineId,
        input.curve,
      ),
    ),
    fitTemplates: os.fitTemplates.handler(({ input }) =>
      callOptional('timelines.fitTemplates', service.fitTemplates?.bind(service), input),
    ),
  });
}
