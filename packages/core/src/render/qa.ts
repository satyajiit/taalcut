// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The QA report on every render (P2-M8, docs/qa-gate.md): checks, their
 * findings and fixes, the verdict and the user's overrides. Render writes it;
 * the QA card, the Reviewer skill and telemetry read it.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { commandNameSchema } from '../commands/definition';
import { exportPresetIdSchema } from './presets';

export const QA_CHECK_IDS = [
  'preflightMedia',
  'preflightFonts',
  'rightsReferenceAudio',
  'container',
  'codec',
  'resolution',
  'aspectRatio',
  'frameRate',
  'duration',
  'bitrate',
  'blackFrames',
  'frozenFrames',
  'blackBars',
  'avSync',
  'beatSync',
  'loudness',
  'silence',
  'captionSafeZone',
  'captionOverflow',
  'captionGlyphs',
  'captionReadability',
  // P3: reframing (V2), motion graphics (V13), voice under music (V6), Content Credentials (V7), brand kits (V10).
  'subjectInFrame',
  'cropJitter',
  'captionCoversFace',
  'graphicsSafeZone',
  'graphicsOverlap',
  'graphicsReadability',
  'voiceOverMusic',
  'contentCredentials',
  'brandAssets',
  // LRN1-STY: a render made like a set of references keeps its median shot inside the set's pacing band.
  'stylePacing',
  // FRM1-OVL: no graphic or text item covers a person's head, on any frame of its time.
  'graphicCoversFace',
  // AGT2-MATCH: the draft against its template, slot by slot (SLOT_MATCH_CHECK_IDS).
  'slotNeeds',
  'slotFace',
  'slotFraming',
  'slotMotion',
  'slotTiming',
  'slotGraphics',
  // EAR1-A2: the render heard (SoundListener): a sound on each cut, a clean mix, and the sound critique (warns only).
  'soundOnCuts',
  'soundClean',
  'soundCritique',
] as const;
export const qaCheckIdSchema = z.enum(QA_CHECK_IDS);
export type QaCheckId = z.infer<typeof qaCheckIdSchema>;

/**
 * AGT2-MATCH: the checks that hold a draft made from a template to that template, one slot at a time: what the slot's
 * footage must show (its intent's `needs`), the face shown or kept out (`face`), where the subject sits against the
 * reel's, the camera's move, the slot's length and cut, and the reel's graphics in the reel's place. Each finding
 * covers one slot's frames on the draft; `video.done` reads them per slot.
 */
export const SLOT_MATCH_CHECK_IDS = [
  'slotNeeds',
  'slotFace',
  'slotFraming',
  'slotMotion',
  'slotTiming',
  'slotGraphics',
] as const satisfies readonly QaCheckId[];
export type SlotMatchCheckId = (typeof SLOT_MATCH_CHECK_IDS)[number];

export const QA_STATUSES = ['pass', 'warn', 'fail', 'fixed', 'skipped'] as const;
export const QA_UNITS = [
  'frames',
  'ms',
  'lufs',
  'dbtp',
  'db',
  'px',
  'kbps',
  'seconds',
  'ratio',
  'count',
  /** A loudness difference (voice over music). */
  'lu',
  'percent',
] as const;
export const QA_VERDICTS = ['passed', 'passedWithWarnings', 'needsAttention', 'overridden'] as const;
export const QA_MAX_ROUNDS = 3;

const measure = z.object({ value: z.number(), unit: z.enum(QA_UNITS) });

export const qaFixSchema = z.discriminatedUnion('kind', [
  /** The render process applies it itself; the timeline doesn't change. */
  z.object({
    kind: z.literal('auto'),
    action: z.enum(['renormaliseAudio', 'remux', 'reencode', 'rerender']),
  }),
  /** A ready command: the QA card's fix button and the Editor dispatch it as is. */
  z.object({
    kind: z.literal('command'),
    labelKey: z.string().min(1),
    command: commandNameSchema,
    payload: z.unknown(),
  }),
  /** Needs judgment: the Reviewer turns it into Editor steps. Params are ids and numbers, never user text. */
  z.object({
    kind: z.literal('agent'),
    instructionKey: z.string().min(1),
    params: z.record(z.string(), z.union([z.string().max(200), z.number()])),
  }),
]);
export type QaFix = z.infer<typeof qaFixSchema>;

export const qaFindingSchema = z.object({
  /** Frames on the render, [start, end). */
  frames: z.object({ start: z.int().nonnegative(), end: z.int().nonnegative() }).optional(),
  target: z
    .object({ kind: z.enum(['clip', 'caption', 'text', 'audio', 'file']), id: z.string().min(1).max(64) })
    .optional(),
  measured: measure.optional(),
  /** A captured frame for the card and the Reviewer. */
  frameArtifactId: idSchema<'Artifact'>().optional(),
});

export const qaCheckResultSchema = z.object({
  id: qaCheckIdSchema,
  status: z.enum(QA_STATUSES),
  /** 'qa.checks.<id>' */
  labelKey: z.string().min(1),
  measured: measure.optional(),
  threshold: z
    .object({ min: z.number().optional(), max: z.number().optional(), unit: z.enum(QA_UNITS) })
    .optional(),
  findings: z.array(qaFindingSchema).max(50),
  /** The user may export with this check failing ("Export anyway"). */
  overridable: z.boolean(),
  fixes: z.array(qaFixSchema).max(5),
  durationMs: z.int().nonnegative(),
});
export type QaCheckResult = z.infer<typeof qaCheckResultSchema>;

export const qaReportSchema = z.object({
  version: z.literal(1),
  renderId: idSchema<'Render'>(),
  round: z.int().min(1).max(QA_MAX_ROUNDS),
  verdict: z.enum(QA_VERDICTS),
  presetId: exportPresetIdSchema,
  checks: z.array(qaCheckResultSchema),
  overrides: z.array(
    z.object({ check: qaCheckIdSchema, at: z.int().nonnegative(), actor: z.string().min(1) }),
  ),
  createdAt: z.int().nonnegative(),
});
export type QaReport = z.infer<typeof qaReportSchema>;

export const qaSummarySchema = z.object({
  verdict: z.enum(QA_VERDICTS),
  round: z.int().min(1).max(QA_MAX_ROUNDS),
  passed: z.int().nonnegative(),
  warned: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  fixed: z.int().nonnegative(),
  failing: z.array(qaCheckIdSchema),
});
export type QaSummary = z.infer<typeof qaSummarySchema>;
