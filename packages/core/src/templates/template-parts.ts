// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The parts of Template v1 (P2-T1) that other documents reuse: the canvas, the
 * beat map, slot intents, transitions, speed ramps, boxes and text. Timeline v1
 * builds on the same parts, and vision's shot analysis compares against the same
 * enums, so a shot and a slot intent speak one vocabulary. The audio profile is
 * in template-audio.ts (EAR1-K0). See packages/templates/SPEC.md, "Template v1".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/id-schema';
import { frameRateSchema } from '../time/frame-rate-value';
import { rationalTimeSchema } from '../time/rational-time';
import { CAMERA_MOTIONS, cameraMotionMeasureSchema } from './camera-motion';
import { overlayMotionSchema } from './overlay-motion';
import { overlayPlacementSchema } from './overlay-placement';

export * from './overlay-motion';

const time = rationalTimeSchema;
const unit = z.number().min(0).max(1);

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
/** BCP 47: 'en', 'hi', 'pt-BR'. */
export const languageTagSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
/** A key into a Style's text styles: 'title', 'label'. */
export const styleKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/);

export const REFERENCE_INPUTS = ['link', 'file', 'screenRecording'] as const;
export const REFERENCE_PLATFORMS = ['shorts', 'reels', 'tiktok', 'other'] as const;
/** The bundled Formats (P2-T6's two, P3-V1's six). Additive: Template v1 documents parse unchanged. */
export const FORMAT_IDS = [
  'vlog',
  'dayInTheLife',
  'talkingHead',
  'podcastClip',
  'ugcAd',
  'beforeAfter',
  'tutorial',
  'highlightReel',
] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
export const SHOT_TYPES = ['wide', 'medium', 'close', 'detail', 'pov', 'aerial', 'screen', 'text'] as const;
/** FRM1-MOT: defined beside the camera's measure (camera-motion.ts); the same list as ever. */
export { CAMERA_MOTIONS } from './camera-motion';
export const SLOT_ROLES = ['hook', 'body', 'peak', 'outro'] as const;
export const INTENT_SOURCES = ['pending', 'analyst', 'format', 'user'] as const;
/** FIX-HOOK: whether the reel shows the person's face in a slot; how many needs, how long each (SlotIntent). */
export const INTENT_FACES = ['shown', 'hidden'] as const;
export const INTENT_NEEDS_MAX = 3;
export const INTENT_NEED_CHARS = 80;
export const CUT_METHODS = ['both', 'scdet', 'embedding', 'vision', 'rule', 'format', 'user'] as const;
export const TRANSITION_KINDS = [
  'dissolve',
  'fade',
  'whip',
  'zoom',
  'slide',
  'flash',
  'glitch',
  'other',
] as const;
export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export const TEXT_ROLES = ['title', 'label', 'list', 'caption', 'cta', 'other'] as const;
export const TEXT_REVEALS = ['none', 'fade', 'pop', 'slide', 'typewriter', 'wordByWord'] as const;
export const AUDIO_KINDS = ['music', 'voice', 'original', 'mixed', 'silent'] as const;
/**
 * What the breakdown isn't sure of, for the review to ask about (BRK1 §1). A slot's cut doubts are about the cut at
 * its start; a text overlay's are about whether it is an overlay at all; the template's are about the whole reel.
 */
export const DOUBT_REASONS = [
  /** A cut under the confidence line. */
  'cutUnsure',
  /** A whip, dissolve or flash that may be one shot. */
  'cutMaybeTransition',
  /** A slot that is mostly a fade's black or white. */
  'fadeTail',
  /** The description doesn't name a subject and a motion. */
  'intentVague',
  /** AGT1: the description named the reel's places or signs, and Taalcut rewrote it for anyone's footage. */
  'intentGeneralised',
  /** FRM1-MOT: the camera's move was measured, but not surely; the slot's motion stays unknown until a person picks. */
  'motionUnsure',
  /** Text that may be part of the scene: a sign, a shirt, a screen. */
  'textMaybeScene',
  'speechMaybeHallucinated',
  'tempoMaybeHalfOrDouble',
  'soundCreditMissing',
] as const;

export const canvasSchema = z.object({
  width: z.int().min(16).max(8192),
  height: z.int().min(16).max(8192),
  /** Every structure time is a whole number of frames at this rate. */
  rate: frameRateSchema,
});

export const beatMapSchema = z.object({
  /** The tracker's frame rate: e.g. 50/1 (Beat This!), or 1000/1 once audio refined the beats. */
  rate: frameRateSchema,
  /** At least a 10-minute track at 400 BPM. */
  beats: z.array(time).max(4000),
  /** Indices into `beats`, increasing: a downbeat is always a beat. */
  downbeats: z.array(z.int().nonnegative()).max(1000),
  /** Display and beat density only; never used as time. Null for rubato. */
  bpm: z.number().positive().max(400).nullable(),
  beatsPerBar: z.int().min(2).max(12).nullable(),
  /** Share of beats an onset peak confirmed (the second method). */
  confidence: unit,
  source: z.enum(['tracker', 'format', 'user']),
});

export const beatAnchorSchema = z.object({
  beatIndex: z.int().nonnegative(),
  /** Signed, at the canvas rate: the cut is at beats[beatIndex], to the nearest frame, plus this. */
  offset: time,
});

const intentFields = {
  /** One line an editor would write: "wide establishing shot, slow push-in". Plain text. */
  text: z.string().max(500),
  shotType: z.enum(SHOT_TYPES).nullable(),
  motion: z.enum(CAMERA_MOTIONS).nullable(),
  subject: z.string().max(120).nullable(),
  /** People in frame; null when it doesn't matter. */
  people: z.int().min(0).max(50).nullable(),
  place: z.string().max(120).nullable(),
  energy: unit,
  /**
   * FIX-CAST: what the reel's shot literally shows (its places, landmarks, signs), for the review. The other fields
   * say what the shot does, in words that fit anyone's footage; casting never reads this one.
   */
  reel: z.string().max(500).optional(),
  /** FIX-HOOK: what the footage must show for the slot to work (the thing its story or graphic hangs on). */
  needs: z.array(z.string().trim().min(1).max(INTENT_NEED_CHARS)).max(INTENT_NEEDS_MAX).optional(),
  /** FIX-HOOK: whether the reel shows the person's face in the slot; null or absent when it doesn't say. */
  face: z.enum(INTENT_FACES).nullable().optional(),
};

export const slotIntentSchema = z
  .object({ ...intentFields, source: z.enum(INTENT_SOURCES) })
  .refine((intent) => intent.source === 'pending' || intent.text.trim().length > 0, {
    message: 'Intent text is required once written',
    path: ['text'],
  });

/** What `template.slot.editIntent` may change; at least one field. */
export const slotIntentPatchSchema = z
  .object({ ...intentFields, text: z.string().trim().min(1).max(500) })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' });

export const transitionSchema = z.object({
  kind: z.enum(TRANSITION_KINDS),
  /** Before and after the cut, like OTIO's in_offset and out_offset. */
  before: time,
  after: time,
  direction: z.enum(DIRECTIONS).nullable(),
  confidence: unit,
});
export const speedRampSchema = z.object({
  /** Times from the item's start: the first at zero, increasing. Speed 1 is real time. */
  points: z
    .array(z.object({ at: time, speed: z.number().min(0.1).max(16) }))
    .min(2)
    .max(16),
  curve: z.enum(['linear', 'ease', 'hold']),
  /** Offset into the original curve after a cut; preserves ease segments exactly. */
  windowStart: time.optional(),
});
export const cutEvidenceSchema = z.object({ method: z.enum(CUT_METHODS), confidence: unit });

/** One thing the review should ask about. Absent `doubts` means no doubt. */
export const doubtSchema = z.object({
  reason: z.enum(DOUBT_REASONS),
  /** How likely the doubt is right, when the breakdown can say. */
  confidence: unit.optional(),
});
/** The breakdown writes each reason at most once per item. */
export const doubtsSchema = z.array(doubtSchema).max(DOUBT_REASONS.length);

export const templateSlotSchema = z.object({
  id: idSchema<'TemplateSlot'>(),
  /** The user's label; null shows "Slot n". */
  name: z.string().min(1).max(60).nullable(),
  role: z.enum(SLOT_ROLES),
  start: time,
  duration: time,
  intent: slotIntentSchema,
  beatAnchor: beatAnchorSchema.nullable(),
  transitionIn: transitionSchema.nullable(),
  speedRamp: speedRampSchema.nullable(),
  /** How the cut that starts this slot was found. */
  cut: cutEvidenceSchema,
  /** Confirmed by the user: the agent leaves the intent alone. */
  approved: z.boolean(),
  /** This slot's tile in the contact sheet. */
  frame: z.int().nonnegative().nullable(),
  /** BRK1: what the review should ask about this slot and the cut at its start. */
  doubts: doubtsSchema.optional(),
  /** FRM1-MOT: the camera's move through the slot, measured (camera-motion.ts); absent before FRM1. */
  motionMeasure: cameraMotionMeasureSchema.optional(),
});

const EDGE = 1e-6;
/** Normalised to the canvas (or the upright frame), origin top left. */
export const boxSchema = z
  .object({ x: unit, y: unit, width: unit, height: unit })
  .refine((box) => box.x + box.width <= 1 + EDGE && box.y + box.height <= 1 + EDGE, {
    message: 'Box leaves the frame',
  });

export const textAppearanceSchema = z.object({
  /** Cap height as a share of the canvas height. */
  size: z.number().min(0.005).max(0.5),
  align: z.enum(['left', 'center', 'right']),
  case: z.enum(['upper', 'lower', 'mixed']),
  background: z.enum(['none', 'box', 'outline', 'shadow']),
});

/**
 * BRK1-GFX (contract §3): how an overlay is drawn in the reel, read from its frames: a chat bubble, a pill, a label
 * and so on, its colours, its corners and tail, its type, and how it comes on and goes off. An overlay without a
 * design is plain text, as Template v1. Timeline assembly draws a designed overlay as a motion graphic.
 */
export const OVERLAY_DESIGN_KINDS = [
  'plain',
  'chatBubble',
  'pill',
  'label',
  'lowerThird',
  'sticker',
  'callout',
  'cta',
  'kineticTitle',
] as const;
export const OVERLAY_TAILS = ['none', 'left', 'right'] as const;
export const OVERLAY_FONT_CLASSES = ['sans', 'serif', 'rounded', 'mono', 'script', 'display'] as const;
/** '#rrggbb', lower case. */
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const overlayColorsSchema = z.object({
  /** The shape's fill; null when the text sits on the picture. */
  fill: hexColorSchema.nullable(),
  text: hexColorSchema,
  /** An outline round the shape (round the letters for plain text); null for none. */
  stroke: hexColorSchema.nullable(),
});

export const overlayFontSchema = z.object({
  class: z.enum(OVERLAY_FONT_CLASSES),
  weight: z.int().min(100).max(900),
});

export const overlayDesignSchema = z.object({
  kind: z.enum(OVERLAY_DESIGN_KINDS),
  colors: overlayColorsSchema,
  /** Share of the shape's height: 0 is square, 0.5 a full pill. */
  cornerRadius: z.number().min(0).max(0.5),
  /** Which bottom corner a speech tail leaves from. */
  tail: z.enum(OVERLAY_TAILS).default('none'),
  font: overlayFontSchema,
  motion: overlayMotionSchema,
  /** The shape drawn round the text, normalised like the overlay's `box` (which holds the words only). */
  shape: boxSchema.optional(),
  /** A round avatar beside a chat bubble, on its tail's side. */
  avatar: z.boolean().optional(),
  /** BRK1 gate: read ticks (✓✓) inside a chat bubble, on its tail's side of the words. */
  receipt: z.boolean().optional(),
  /** FRM1-OVL: where it sat, relative to the reel's subject or frame (overlay-placement.ts). */
  placement: overlayPlacementSchema.optional(),
  confidence: unit,
});

export const textOverlaySchema = z.object({
  id: idSchema<'TextOverlay'>(),
  /** OCR of the reference: untrusted, kept and shown as plain text only. */
  text: z.string().min(1).max(500),
  role: z.enum(TEXT_ROLES),
  start: time,
  duration: time,
  /** The slot it starts in, so merges and drops can move it. */
  slotId: idSchema<'TemplateSlot'>().nullable(),
  box: boxSchema,
  appearance: textAppearanceSchema,
  styleKey: styleKeySchema,
  /** BRK1: e.g. `textMaybeScene`, kept for the review to ask rather than dropped. */
  doubts: doubtsSchema.optional(),
  reveal: z.enum(TEXT_REVEALS),
  /** BRK1-GFX: how the reel draws it; absent is plain text. */
  design: overlayDesignSchema.optional(),
  language: languageTagSchema.nullable(),
  confidence: unit,
});

export const pacingStatsSchema = z.object({
  shotCount: z.int().min(1),
  meanShot: time,
  medianShot: time,
  shortestShot: time,
  longestShot: time,
  /** End of the first slot, capped at 3 s (taste rule: hook in the first 1.5 s). */
  hookEnd: time,
  /** Share of cuts within one frame of a beat; null without a beat map. */
  cutsOnBeat: unit.nullable(),
});

export const contactSheetSchema = z.object({
  /** sha256 of the low-res image in the template asset store. The reel itself, when kept, is the template's media. */
  asset: sha256Schema,
  mediaType: z.enum(['image/jpeg', 'image/webp']),
  columns: z.int().min(1).max(10),
  rows: z.int().min(1).max(10),
  tile: z.object({ width: z.int().min(16).max(180), height: z.int().min(16).max(180) }),
  /** One per tile, in reading order. */
  frames: z.array(z.object({ at: time, slotId: idSchema<'TemplateSlot'>().nullable() })).max(60),
});

/**
 * How a template's kept reel came to this Mac (REF1): fetched without an account, fetched with the person's
 * Instagram session after that failed, or copied from a file they gave (a dropped file or a screen recording).
 */
export const TEMPLATE_MEDIA_SOURCES = ['anonymous', 'session', 'file'] as const;

/**
 * A template's kept reel, video and music as fetched (REF1, the owner's decision of 2026-10-29 that reverses PRD
 * 10.2's analyse and discard). One per template, shared by every version: versions are immutable, so it is not in
 * the document. The library's template media store keeps it in `<app data>/templates/media/<template id>/`, and a
 * template's summary carries it.
 */
export const templateMediaSchema = z.object({
  /** The file in the template's media folder, e.g. 'reference.mp4' (video and audio, as fetched). */
  file: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  bytes: z.int().positive(),
  durationMs: z.int().positive(),
  sha256: sha256Schema,
  /** False for a silent reel: nothing for the music to use. */
  hasAudio: z.boolean(),
  source: z.enum(TEMPLATE_MEDIA_SOURCES),
  keptAt: z.int().nonnegative(),
});

export type DoubtReason = (typeof DOUBT_REASONS)[number];
export type Doubt = z.output<typeof doubtSchema>;
export type Canvas = z.output<typeof canvasSchema>;
export type BeatMap = z.output<typeof beatMapSchema>;
export type BeatAnchor = z.output<typeof beatAnchorSchema>;
export type SlotIntent = z.output<typeof slotIntentSchema>;
export type SlotIntentPatch = z.output<typeof slotIntentPatchSchema>;
export type Transition = z.output<typeof transitionSchema>;
export type SpeedRamp = z.output<typeof speedRampSchema>;
export type TemplateSlot = z.output<typeof templateSlotSchema>;
export type Box = z.output<typeof boxSchema>;
export type TextOverlay = z.output<typeof textOverlaySchema>;
export type OverlayDesignKind = (typeof OVERLAY_DESIGN_KINDS)[number];
export type OverlayTail = (typeof OVERLAY_TAILS)[number];
export type OverlayFontClass = (typeof OVERLAY_FONT_CLASSES)[number];
export type OverlayColors = z.output<typeof overlayColorsSchema>;
export type OverlayFont = z.output<typeof overlayFontSchema>;
export type OverlayDesign = z.output<typeof overlayDesignSchema>;
export type PacingStats = z.output<typeof pacingStatsSchema>;
export type ContactSheet = z.output<typeof contactSheetSchema>;
export type TemplateMediaSource = (typeof TEMPLATE_MEDIA_SOURCES)[number];
export type TemplateMedia = z.output<typeof templateMediaSchema>;
