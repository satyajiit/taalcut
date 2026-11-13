// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's media cards (round P3-1, C-27): a voiceover (P3-B6), recording a voice consent (P3-B6), a motion
 * graphic (P3-V13), a batch of renders (P3-V16) and generated image takes (P3-B7). Buttons that spend money send a
 * follow-up to the run; the rest dispatch commands.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';
import { exportPresetIdSchema } from '../render/presets';
import { renderBatchProgressSchema } from '../render/render-types';
import { voiceLineSchema } from '../timeline/voiceover';
import { rationalTimeSchema } from '../time/rational-time';
import { base, runId } from './card-parts';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const language = z.string().min(2).max(35);

export const VOICEOVER_QUALITIES = ['draft', 'final', 'mixed'] as const;

/** U-1: the voiceover the Voice director made. */
export const voiceoverCardSchema = z.object({
  type: z.literal('voiceover'),
  ...base,
  runId: runId.optional(),
  projectId,
  timelineId,
  voiceover: z.object({
    id: idSchema<'Voiceover'>(),
    voiceName: z.string().max(80),
    own: z.boolean(),
    language,
    lines: z.array(voiceLineSchema).max(40),
  }),
  quality: z.enum(VOICEOVER_QUALITIES),
  spent: moneySchema,
  /** What a final pass would cost now; null: nothing. */
  finalizeEstimate: moneySchema.nullable(),
  ducking: z.object({ enabled: z.boolean(), minMarginLu: z.number().nullable() }).nullable(),
});

export const VOICE_CONSENT_CARD_STATUSES = [
  'ready',
  'recording',
  'checking',
  'mismatch',
  'stored',
  'cloned',
  'failed',
] as const;

/** U-4: recording the user's own voice with the consent line. Started by a person; the agent only offers it. */
export const voiceConsentCardSchema = z.object({
  type: z.literal('voiceConsent'),
  ...base,
  consentId: idSchema<'VoiceConsent'>(),
  termsVersion: z.string().min(1).max(16),
  language,
  status: z.enum(VOICE_CONSENT_CARD_STATUSES),
  /** On mismatch: what the local transcript heard; untrusted. */
  heard: z.string().max(300).optional(),
});

/**
 * U-3, HFW1: a graphic the AI designed and where it sits. It names its `composition` (the card reads the rest, its
 * variables and version, from the live timeline's copy). HFW1 retire: the kit's kind and fields are gone.
 */
export const motionGraphicCardSchema = z.object({
  type: z.literal('motionGraphic'),
  ...base,
  /** EDT1-GFX: the run that made it, so "Try again" goes to that chat as a follow-up. */
  runId: runId.optional(),
  projectId,
  timelineId,
  itemId: idSchema<'TimelineItem'>(),
  /**
   * The composition it is drawn with, as placed: its id and its name (the designing model's words, shown as
   * content), for the card's title before the live timeline is read.
   */
  composition: z.object({ id: idSchema<'GraphicComposition'>(), name: z.string().trim().min(1).max(60) }),
  /** Where it sits on the timeline, at the canvas rate (the stored graphic's `start` and `duration`). */
  start: rationalTimeSchema,
  duration: rationalTimeSchema.refine((time) => time.value > 0, { message: 'Duration must be positive' }),
  /** Phrases the anchor couldn't find in the captions; untrusted. */
  unmatched: z.array(z.string().max(80)).max(6),
  /** A poster frame: a still from the composition's newest render. */
  frameArtifactId: z.string().min(1).optional(),
});

export const RENDER_BATCH_ITEM_STATUSES = [
  'queued',
  'running',
  'ready',
  'needsAttention',
  'failed',
  'cancelled',
] as const;

/** U-5: a batch of renders in one queue. */
export const renderBatchCardSchema = z.object({
  type: z.literal('renderBatch'),
  ...base,
  runId: runId.optional(),
  progress: renderBatchProgressSchema,
  items: z
    .array(
      z.object({
        projectId,
        timelineId,
        renderId: idSchema<'Render'>().nullable(),
        presetId: exportPresetIdSchema,
        status: z.enum(RENDER_BATCH_ITEM_STATUSES),
      }),
    )
    .max(50),
  /** Set while the batch waits for its one approval. */
  approvalId: z.string().min(1).optional(),
});

/** U-6: generated stills for a slot before more are paid for (one per images.generateForSlot call that asks). */
export const imageTakesCardSchema = z.object({
  type: z.literal('imageTakes'),
  ...base,
  runId,
  projectId,
  timelineId,
  slotId: idSchema<'TemplateSlot'>(),
  takes: z
    .array(
      z.object({
        assetId: idSchema<'Asset'>(),
        provider: z.string().min(1).max(64),
        model: z.string().min(1).max(128),
        thumbnailArtifactId: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
  placed: idSchema<'Asset'>().nullable(),
  spent: moneySchema,
});
