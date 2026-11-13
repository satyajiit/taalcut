// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeline command names and payloads (P2-M1, P2-M4, P2-M7, P2-M8, P3), so the
 * editor, the cast board, ⌘K and the agent dispatch them typed. Handlers are
 * @taalcut/timeline's. All are write; `restore` (every edit's inverse) and
 * `discard` (create's inverse) are internal. Results are
 * `{ timelineId, revision }` (`create`: `{ timelineIds }`; `exportInterchange`:
 * InterchangeExportResult, not undoable, changes nothing in the app).
 */
import '../basics/zod-config';
import { coverSettingsSchema } from './cover';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { captionTrackSchema } from '../render/captions';
import { musicChoiceSchema } from '../render/music';
import { energyCurveSchema } from '../templates/energy-curve';
import { beatMapSchema, boxSchema } from '../templates/template-parts';
import { templateRefSchema } from '../templates/template-schema';
import { castCandidateSchema, castStateSchema } from './cast-schema';
import { cleanupPlanSchema } from './cleanup';
import { gradeSchema } from './grade';
import { INTERCHANGE_FORMATS, INTERCHANGE_PATH_STYLES } from './interchange';
import { timelineMixSchema } from './mix';
import { CLIP_FITS, clipReframeSchema, markerSchema, STILL_MOTIONS, trackSchema } from './timeline-items';
import { timelineSchema } from './timeline-schema';
import { voiceoverSchema } from './voiceover';
import { clipVisualLayoutSchema } from './visual-layout';

export const TIMELINE_COMMANDS = {
  create: 'timeline.create',
  swapClip: 'timeline.swapClip',
  trimClip: 'timeline.trimClip',
  moveClip: 'timeline.moveClip',
  editText: 'timeline.editText',
  moveText: 'timeline.moveText',
  lockClip: 'timeline.lockClip',
  applyCast: 'timeline.applyCast',
  /** Render QA's fixes (P2-M8): black bars, beat drift, too long for the platform. */
  setClipFit: 'timeline.setClipFit',
  resyncBeats: 'timeline.resyncBeats',
  trimToDuration: 'timeline.trimToDuration',
  /** P3-V5: writes an OTIO or FCPXML file; not undoable (changes nothing in the app), audited. */
  exportInterchange: 'timeline.exportInterchange',
  /** P3-B8: a gap becomes a clip of a still or a video. */
  fillGap: 'timeline.fillGap',
  /** P3-B8: a clip or gap on V1 goes; the rest ripples or the previous clip extends. */
  dropSlot: 'timeline.dropSlot',
  /** P3-V9: a cleanup plan from timelines.planCleanup, in one undo step. */
  applyCleanup: 'timeline.applyCleanup',
  /** P3-V12: re-splits the template's slots in this project (and moves the template's head). */
  applyEnergyCurve: 'timeline.applyEnergyCurve',
  /** P3-V10: the timeline's look. */
  setStyle: 'timeline.setStyle',
  /** P3-V2: a clip's reframe. */
  setReframe: 'timeline.setReframe',
  setVisualLayout: 'timeline.setVisualLayout',
  /** P3-B8: slots the person will film (cast note filmRequested; the phone's shot list). */
  markForFilming: 'timeline.markForFilming',
  /** Internal: the inverse of every edit. */
  restore: 'timeline.restore',
  /** Internal: the inverse of create. */
  discard: 'timeline.discard',
} as const;

export const SWAP_SOURCES = ['alternate', 'search', 'agent'] as const;
/** `timeline.dropSlot`: close the hole (ripple) or let the clip before cover it. */
export const DROP_MODES = ['ripple', 'extendPrevious'] as const;

const projectId = idSchema<'Project'>();
const target = { projectId, timelineId: idSchema<'Timeline'>(), revision: z.int().positive().optional() };
const itemId = idSchema<'TimelineItem'>();
const slotPick = z.object({ slotId: idSchema<'TemplateSlot'>(), pick: castCandidateSchema });
const positiveDurationSchema = rationalTimeSchema.refine((time) => time.value > 0, {
  message: 'Duration must be positive',
});
const textEditEntrySchema = z.object({
  itemId,
  text: z.string().trim().min(1).max(500).optional(),
  start: rationalTimeSchema.optional(),
  duration: positiveDurationSchema.optional(),
  box: boxSchema.optional(),
  remove: z.boolean().optional(),
});
const textMoveEntrySchema = z.object({
  itemId,
  box: boxSchema,
});

export const timelineCommandPayloads = {
  [TIMELINE_COMMANDS.create]: z.object({ projectId, timelines: z.array(timelineSchema).min(1).max(10) }),
  [TIMELINE_COMMANDS.swapClip]: z.object({
    ...target,
    clipId: itemId,
    media: z.object({ assetId: idSchema<'Asset'>(), shotId: idSchema<'Shot'>().nullable() }),
    sourceStart: rationalTimeSchema.optional(),
    from: z.enum(SWAP_SOURCES),
    /**
     * LRN1-PREF: the score and parts casting gave the shot where the person picked it (the cast's alternates,
     * timelines.findAlternates). The slot's pick records them; the preference learner reads them from the log.
     */
    scored: castCandidateSchema.pick({ score: true, parts: true }).optional(),
  }),
  [TIMELINE_COMMANDS.trimClip]: z.object({
    ...target,
    clipId: itemId,
    edge: z.enum(['start', 'end']),
    /** Signed, at the canvas rate: positive lengthens the clip at that edge. */
    by: rationalTimeSchema,
  }),
  [TIMELINE_COMMANDS.moveClip]: z.object({ ...target, clipId: itemId, toIndex: z.int().min(0).max(399) }),
  [TIMELINE_COMMANDS.editText]: z
    .object({
      ...target,
      itemId: itemId.optional(),
      text: z.string().trim().min(1).max(500).optional(),
      start: rationalTimeSchema.optional(),
      duration: positiveDurationSchema.optional(),
      box: boxSchema.optional(),
      remove: z.boolean().optional(),
      edits: z.array(textEditEntrySchema).min(1).max(50).optional(),
    })
    .refine((payload) => payload.itemId !== undefined || (payload.edits?.length ?? 0) > 0, {
      message: 'Give itemId or edits',
    }),
  [TIMELINE_COMMANDS.moveText]: z
    .object({
      ...target,
      itemId: itemId.optional(),
      itemIds: z.array(itemId).min(1).max(50).optional(),
      box: boxSchema,
      moves: z.array(textMoveEntrySchema).min(1).max(50).optional(),
    })
    .refine(
      (payload) =>
        payload.itemId !== undefined ||
        (payload.itemIds?.length ?? 0) > 0 ||
        (payload.moves?.length ?? 0) > 0,
      { message: 'Give itemId, itemIds, or moves' },
    ),
  [TIMELINE_COMMANDS.lockClip]: z.object({ ...target, clipId: itemId, locked: z.boolean() }),
  [TIMELINE_COMMANDS.applyCast]: z.object({
    ...target,
    picks: z.array(slotPick).min(1).max(200),
  }),
  [TIMELINE_COMMANDS.setVisualLayout]: z.object({
    ...target,
    clipId: itemId,
    visualLayout: clipVisualLayoutSchema.nullable(),
  }),
  [TIMELINE_COMMANDS.setClipFit]: z.object({ ...target, clipId: itemId, fit: z.enum(CLIP_FITS) }),
  /** Every cut, the end included, back onto the timeline's beat grid; clips take the anchor of their start. */
  [TIMELINE_COMMANDS.resyncBeats]: z.object(target),
  /** Shortens the video from its end so the timeline lasts at most `maxSeconds`; text and markers past it go. */
  [TIMELINE_COMMANDS.trimToDuration]: z.object({ ...target, maxSeconds: z.number().positive().max(3600) }),
  [TIMELINE_COMMANDS.exportInterchange]: z.object({
    ...target,
    format: z.enum(INTERCHANGE_FORMATS),
    /** Default: the latest. A different current revision is core.conflict. */
    revision: z.int().positive().optional(),
    pathStyle: z.enum(INTERCHANGE_PATH_STYLES).default('fileUrl'),
  }),
  [TIMELINE_COMMANDS.fillGap]: z.object({
    ...target,
    gapId: itemId,
    media: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('image'),
        assetId: idSchema<'Asset'>(),
        stillMotion: z.enum(STILL_MOTIONS).default('pushIn'),
      }),
      z.object({
        kind: z.literal('video'),
        assetId: idSchema<'Asset'>(),
        shotId: idSchema<'Shot'>().nullable(),
        sourceStart: rationalTimeSchema.optional(),
      }),
    ]),
  }),
  [TIMELINE_COMMANDS.dropSlot]: z.object({
    ...target,
    /** A clip or a gap on V1. */
    itemId,
    mode: z.enum(DROP_MODES).default('ripple'),
  }),
  [TIMELINE_COMMANDS.applyCleanup]: z.object({ ...target, plan: cleanupPlanSchema }),
  [TIMELINE_COMMANDS.applyEnergyCurve]: z.object({
    ...target,
    templateBaseVersion: z.int().min(1),
    curve: energyCurveSchema,
    /** Picks for the changed slots, from timelines.planEnergyCurve, so redo makes the same document. */
    picks: z.array(slotPick).max(200),
  }),
  [TIMELINE_COMMANDS.setStyle]: z.object({ ...target, styleId: idSchema<'Style'>().nullable() }),
  [TIMELINE_COMMANDS.setReframe]: z.object({
    ...target,
    revision: z.int().positive().optional(),
    clipId: itemId,
    reframe: clipReframeSchema.nullable(),
  }),
  [TIMELINE_COMMANDS.markForFilming]: z.object({
    ...target,
    slotIds: z.array(idSchema<'TemplateSlot'>()).min(1).max(60),
    on: z.boolean(),
  }),
  [TIMELINE_COMMANDS.restore]: z.object({
    ...target,
    tracks: z.array(trackSchema).optional(),
    markers: z.array(markerSchema).optional(),
    cast: castStateSchema.nullable().optional(),
    beatMap: beatMapSchema.nullable().optional(),
    /** music.choosePath's inverse: the choice as it was, with the cuts a re-time to the user's track moved. */
    music: musicChoiceSchema.optional(),
    /** The caption track as it was, for an edit that moved or clamped its cues (a ripple trim, a move). */
    captions: captionTrackSchema.nullable().optional(),
    /** P3: the look, the voiceover and the mix as they were. */
    styleId: idSchema<'Style'>().nullable().optional(),
    voiceover: voiceoverSchema.nullable().optional(),
    mix: timelineMixSchema.optional(),
    /** The timeline's template ref as it was (the energy curve's inverse). */
    template: templateRefSchema.nullable().optional(),
    /** EDT1-OPS: the whole video's grade as it was; null when it had none. */
    grade: gradeSchema.nullable().optional(),
    covers: z.array(coverSettingsSchema).max(4).nullable().optional(),
    /** Moves a template's head back in the same unit of work (core.conflict unless the head is `expectedHead`). */
    templateHead: z
      .object({ templateId: idSchema<'Template'>(), version: z.int().min(1), expectedHead: z.int().min(1) })
      .optional(),
  }),
  [TIMELINE_COMMANDS.discard]: z.object({
    projectId,
    timelineIds: z.array(idSchema<'Timeline'>()).min(1).max(10),
  }),
};
