// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template command names and payloads (P2-T1, P2-T6), so the renderer, ⌘K
 * and the agent dispatch them typed. Handlers are @taalcut/templates'
 * `createTemplateCommands`. Every payload carries `projectId` (nullable), so
 * the bus's default puts the edit in that project's history. Structural
 * edits name the version they were made on (`baseVersion`) and make a new
 * immutable version; `template.setHead` is their inverse.
 *
 * Side effects: `template.delete` is destructive; `setHead`, `discard`,
 * `restoreFolders` and `discardMany` are internal; the rest are write.
 * Library metadata (P3-V14: tags, favourites, trend dates, folders,
 * imports, starters) is app-wide history (`projectId: null`) and makes no
 * new version; `setStyle` and `setEnergyCurve` make one, inverse `setHead`.
 *
 * BRK1 (the review): moveCut, split, setRole, text.remove, setTempo and
 * doubt.dismiss are structural edits too. Text overlays, beat anchors and
 * contact-sheet frames follow every one of them by start time.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { idSchema, type TemplateId } from '../basics/ids';
import { HUB_MAX_BYTES } from '../hub/hub-template';
import { energyCurveSchema } from './energy-curve';
import { graphicBriefPatchSchema } from './graphic-brief';
import { graphicComponentsSchema } from './graphic-components';
import { starterIdSchema } from './starters';
import { MAX_TEMPLATE_TAGS, templateTagSchema, trendFreshnessSchema } from './template-library';
import { rationalTimeSchema } from '../time/rational-time';
import { soundUrlSchema } from './template-audio';
import { CAMERA_MOTIONS, DOUBT_REASONS, SLOT_ROLES, slotIntentPatchSchema } from './template-parts';
import { templateSchema } from './template-schema';

export const TEMPLATE_COMMANDS = {
  create: 'template.create',
  rename: 'template.rename',
  setListed: 'template.setListed',
  archive: 'template.archive',
  remove: 'template.delete',
  approveSlots: 'template.slot.approve',
  renameSlot: 'template.slot.rename',
  mergeSlots: 'template.slot.merge',
  dropSlot: 'template.slot.drop',
  /** A typed description is `intent: { text }`; from `ui` the intent's `source` becomes 'user'. */
  editIntent: 'template.slot.editIntent',
  /** Internal: the inverse of every structural edit. */
  setHead: 'template.setHead',
  /** Internal: the inverse of create (deletes when unused, else archives). */
  discard: 'template.discard',
  setTags: 'template.setTags',
  setFavourite: 'template.setFavourite',
  setTrendDate: 'template.setTrendDate',
  moveToFolder: 'template.moveToFolder',
  /** Internal: moveToFolder's inverse, each template's previous folder. */
  restoreFolders: 'template.restoreFolders',
  /** 1–50 template files (Hub template v0) in one undo step. */
  import: 'template.import',
  /** Internal: import's inverse. */
  discardMany: 'template.discardMany',
  /** Forks a bundled starter (P3-B3); inverse `template.discard`. */
  addStarter: 'template.addStarter',
  /** A new version with `styleId`. */
  setStyle: 'template.setStyle',
  /** A new version re-split by the energy curve (P3-V12). */
  setEnergyCurve: 'template.setEnergyCurve',
  /** BRK1: moves the cut at a slot's start, which is the end of the slot before it. Not on the first slot. */
  moveCut: 'template.slot.moveCut',
  /** BRK1: adds a cut inside a slot. The second half copies the intent, unapproved; its cut is the user's. */
  splitSlot: 'template.slot.split',
  setRole: 'template.slot.setRole',
  /** BRK1: removes text overlays (the review's "Not text"). */
  removeText: 'template.text.remove',
  /** BRK1: halves or doubles the beat map; anchors and `bpm` follow. */
  setTempo: 'template.setTempo',
  /** BRK1: removes one doubt from a slot, an overlay or the template. */
  dismissDoubt: 'template.doubt.dismiss',
  /** BRK1-REV: writes (or clears) the reel's sound credit; a credit answers `soundCreditMissing`. */
  setSoundCredit: 'template.setSoundCredit',
  /**
   * FRM1-MOT: sets (or clears, with null) a slot's camera move, as a person picks it; answers the slot's
   * `motionUnsure`. The slot's measure stays as it was measured.
   */
  setMotion: 'template.setMotion',
  /**
   * HFW1: a new version with these graphics (compositions and the overlays they draw), as the template's design or
   * `workspace.promote` leaves them; null removes them, so no overlay is drawn as a graphic until one is designed. It
   * sets `compositions` and `uses` only and never touches `graphics.reading` (the breakdown's briefs, DSG1-READ).
   */
  setGraphics: 'template.setGraphics',
  /**
   * DSG1-READ: says whether an overlay is a graphic (the review's "Not a graphic", and its restore), on
   * `graphics.reading.briefs`. Not a graphic: made videos leave it out. The brief's other fields stay as they were.
   */
  setGraphic: 'template.graphic.set',
  /** DSG1-READ: changes an overlay's brief in `graphics.reading` as the person writes it (`graphicBriefPatchSchema`). */
  editGraphic: 'template.graphic.edit',
} as const;

/**
 * Where a moved or new cut lands: on the nearest canvas frame, or on the nearest beat between the neighbouring
 * cuts (`templates.no_beat_map` without a beat map).
 */
export const CUT_SNAPS = ['frame', 'beat'] as const;
export type CutSnap = (typeof CUT_SNAPS)[number];
/** `template.setTempo`'s factors: the beat tracker's usual mistakes are half and double the tempo. */
export const TEMPO_FACTORS = [0.5, 2] as const;
export type TempoFactor = (typeof TEMPO_FACTORS)[number];
/** The most overlays one `template.text.remove` takes (a template holds at most 500). */
export const MAX_TEXT_REMOVALS = 500;

/** Which item a doubt is on: a slot (and the cut at its start), a text overlay, or the whole reel. */
export const doubtTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slot'), slotId: idSchema<'TemplateSlot'>() }),
  z.object({ kind: z.literal('text'), overlayId: idSchema<'TextOverlay'>() }),
  z.object({ kind: z.literal('template') }),
]);
export type DoubtTarget = z.output<typeof doubtTargetSchema>;

/** BRK1: `template.slot.moveCut` on the first slot, which has no cut at its start. */
export const TemplateFirstSlotCut = defineError('templates.first_slot_cut');
/**
 * BRK1: a moved or new cut that doesn't leave at least one frame on each side, inside the neighbouring cuts (or,
 * snapped to a beat, no beat lies there).
 */
export const TemplateCutOutOfRange = defineError('templates.cut_out_of_range');
/** BRK1: an overlay id the template's version doesn't have. */
export const TemplateOverlayNotFound = defineError('templates.overlay_not_found');
/** BRK1: `template.doubt.dismiss` of a doubt its target doesn't have. */
export const TemplateDoubtNotFound = defineError('templates.doubt_not_found');

const slotId = idSchema<'TemplateSlot'>();
const time = rationalTimeSchema;
const where = { projectId: idSchema<'Project'>().nullable(), templateId: idSchema<'Template'>() };
const edit = { ...where, baseVersion: z.int().min(1) };
const name = z.string().trim().min(1).max(120);
const templateId = idSchema<'Template'>();
const folderId = idSchema<'TemplateFolder'>();
/** Library metadata is app-wide history. */
const app = { projectId: z.null().default(null) };

/**
 * BRK1-REV: the reel's sound as the person credits it: its title, its artist, a link to it (https), at least one.
 * Written to `audio.sound`; null clears it.
 */
export const soundCreditSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    artist: z.string().trim().min(1).max(200).optional(),
    url: soundUrlSchema.optional(),
  })
  .refine((credit) => credit.title !== undefined || credit.artist !== undefined || credit.url !== undefined, {
    message: 'A sound credit needs a title, an artist or a link',
  });
export type SoundCredit = z.output<typeof soundCreditSchema>;

export const templateCommandPayloads = {
  [TEMPLATE_COMMANDS.create]: z.object({
    projectId: idSchema<'Project'>().nullable(),
    /** Version 1, parentVersion null. */
    template: templateSchema,
    name,
    listed: z.boolean(),
  }),
  [TEMPLATE_COMMANDS.rename]: z.object({ ...where, name }),
  [TEMPLATE_COMMANDS.setListed]: z.object({ ...where, listed: z.boolean() }),
  [TEMPLATE_COMMANDS.archive]: z.object({ ...where, archived: z.boolean() }),
  [TEMPLATE_COMMANDS.remove]: z.object(where),
  [TEMPLATE_COMMANDS.approveSlots]: z.object({
    ...edit,
    slotIds: z.array(slotId).min(1).max(200),
    approved: z.boolean().default(true),
  }),
  [TEMPLATE_COMMANDS.renameSlot]: z.object({
    ...edit,
    slotId,
    name: z.string().trim().min(1).max(60).nullable(),
  }),
  [TEMPLATE_COMMANDS.mergeSlots]: z.object({
    ...edit,
    slotIds: z.array(slotId).min(2).max(50),
    intentFrom: slotId.optional(),
  }),
  [TEMPLATE_COMMANDS.dropSlot]: z.object({ ...edit, slotId }),
  [TEMPLATE_COMMANDS.editIntent]: z.object({ ...edit, slotId, intent: slotIntentPatchSchema }),
  [TEMPLATE_COMMANDS.setHead]: z.object({ ...where, version: z.int().min(1), expectedHead: z.int().min(1) }),
  [TEMPLATE_COMMANDS.discard]: z.object(where),
  [TEMPLATE_COMMANDS.setTags]: z.object({
    ...app,
    templateId,
    tags: z.array(templateTagSchema).max(MAX_TEMPLATE_TAGS),
  }),
  [TEMPLATE_COMMANDS.setFavourite]: z.object({ ...app, templateId, favourite: z.boolean() }),
  [TEMPLATE_COMMANDS.setTrendDate]: z.object({
    ...app,
    templateId,
    trendFreshness: trendFreshnessSchema.nullable(),
  }),
  [TEMPLATE_COMMANDS.moveToFolder]: z.object({
    ...app,
    templateIds: z.array(templateId).min(1).max(200),
    folderId: folderId.nullable(),
  }),
  [TEMPLATE_COMMANDS.restoreFolders]: z.object({
    ...app,
    moves: z
      .array(z.object({ templateId, folderId: folderId.nullable() }))
      .min(1)
      .max(200),
  }),
  [TEMPLATE_COMMANDS.import]: z.object({
    ...app,
    /** Each `text` is a `.taalcut-template` file; the caller makes each `templateId`. */
    items: z
      .array(z.object({ templateId, text: z.string().min(2).max(HUB_MAX_BYTES) }))
      .min(1)
      .max(50),
  }),
  [TEMPLATE_COMMANDS.discardMany]: z.object({ ...app, templateIds: z.array(templateId).min(1).max(50) }),
  [TEMPLATE_COMMANDS.addStarter]: z.object({ ...app, starterId: starterIdSchema, templateId }),
  [TEMPLATE_COMMANDS.setStyle]: z.object({ ...edit, styleId: idSchema<'Style'>().nullable() }),
  [TEMPLATE_COMMANDS.setEnergyCurve]: z.object({ ...edit, curve: energyCurveSchema }),
  /** `to`: the slot's new start, at any rate; it lands on a canvas frame (or a beat). */
  [TEMPLATE_COMMANDS.moveCut]: z.object({
    ...edit,
    slotId,
    to: time,
    snap: z.enum(CUT_SNAPS).default('frame'),
  }),
  /** `at`: where the new cut goes, at any rate; it lands on a canvas frame (or a beat) inside the slot. */
  [TEMPLATE_COMMANDS.splitSlot]: z.object({
    ...edit,
    slotId,
    at: time,
    snap: z.enum(CUT_SNAPS).default('frame'),
  }),
  [TEMPLATE_COMMANDS.setRole]: z.object({ ...edit, slotId, role: z.enum(SLOT_ROLES) }),
  [TEMPLATE_COMMANDS.removeText]: z.object({
    ...edit,
    overlayIds: z.array(idSchema<'TextOverlay'>()).min(1).max(MAX_TEXT_REMOVALS),
  }),
  [TEMPLATE_COMMANDS.setTempo]: z.object({
    ...edit,
    factor: z.union([z.literal(TEMPO_FACTORS[0]), z.literal(TEMPO_FACTORS[1])]),
  }),
  [TEMPLATE_COMMANDS.dismissDoubt]: z.object({
    ...edit,
    target: doubtTargetSchema,
    reason: z.enum(DOUBT_REASONS),
  }),
  [TEMPLATE_COMMANDS.setSoundCredit]: z.object({ ...edit, credit: soundCreditSchema.nullable() }),
  [TEMPLATE_COMMANDS.setMotion]: z.object({ ...edit, slotId, motion: z.enum(CAMERA_MOTIONS).nullable() }),
  [TEMPLATE_COMMANDS.setGraphics]: z.object({ ...edit, graphics: graphicComponentsSchema.nullable() }),
  [TEMPLATE_COMMANDS.setGraphic]: z.object({
    ...edit,
    overlayId: idSchema<'TextOverlay'>(),
    graphic: z.boolean(),
  }),
  [TEMPLATE_COMMANDS.editGraphic]: z.object({
    ...edit,
    overlayId: idSchema<'TextOverlay'>(),
    brief: graphicBriefPatchSchema,
  }),
};

/** Every edit command's result: the new head. */
export interface TemplateEditResult {
  readonly templateId: TemplateId;
  readonly version: number;
}
