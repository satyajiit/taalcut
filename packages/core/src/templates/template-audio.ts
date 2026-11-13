// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1's sound (P2-T1): the audio profile, moved here from template-parts.ts unchanged (EAR1-K0), and what
 * the breakdown heard in the reel (EAR1, `listening`): its events, sections and measurements, how its cuts sync to
 * its sound, and the effects it put on its cuts. Additive and optional, so every Template v1 parses unchanged; the
 * template schema stays version 1. See packages/templates/SPEC.md, "Template v1".
 */
import '../basics/zod-config';
import { z } from 'zod';
import {
  listenModelSchema,
  soundEventSchema,
  soundMeasuresSchema,
  soundSectionSchema,
} from '../audio/listening';
import { cutSyncReportSchema, soundRealnessSchema } from '../audio/listening-report';
import { frameRateSchema } from '../time/frame-rate-value';
import { rationalTimeSchema } from '../time/rational-time';
import { SFX_CATEGORIES } from '../timeline/mix';
import { AUDIO_KINDS, languageTagSchema } from './template-parts';

const time = rationalTimeSchema;
const unit = z.number().min(0).max(1);

/** BRK1-REV: a link to a reel's sound: https only, as a pasted reel's link is. */
export const soundUrlSchema = z.url({ protocol: /^https$/ }).max(2048);

export const TEMPLATE_LISTENING_VERSION = 1;
/** A template keeps the reel's most prominent events, at most this many. */
export const TEMPLATE_LISTENING_EVENTS_MAX = 400;

/** An effect the reel put on a cut, as the breakdown heard it: what a draft's `sfx.setHits` copies (EAR1-C2). */
export const sfxAtCutSchema = z.object({
  /** The slot whose cut it is (the cut sync report's `cutIndex`). */
  cutIndex: z.int().nonnegative(),
  family: z.enum(SFX_CATEGORIES),
  /** What it sounded like, for the agent: the event's top phrase or a bank sound id. Plain text. */
  soundHint: z.string().min(1).max(120).optional(),
  /** The effect against the cut (its attack, or a swell's peak); negative when it comes early. */
  offsetMs: z.number().min(-1000).max(1000),
});
export type SfxAtCut = z.output<typeof sfxAtCutSchema>;

/** What the breakdown heard in the reel (EAR1-C1). Its key and tempo are in `measures`. */
export const templateListeningSchema = z.object({
  version: z.literal(TEMPLATE_LISTENING_VERSION),
  /** Null when no model ran (signal processing only: no tags, sections or realness). */
  model: listenModelSchema.nullable(),
  measures: soundMeasuresSchema,
  events: z.array(soundEventSchema).max(TEMPLATE_LISTENING_EVENTS_MAX),
  sections: z.array(soundSectionSchema).max(60),
  /** The reel's sound against its own cuts (the slots' starts). */
  cutSync: cutSyncReportSchema,
  sfxAtCuts: z.array(sfxAtCutSchema).max(200),
  realness: soundRealnessSchema.optional(),
  /**
   * The reel's own sound-critique metrics (audio's filmMetrics, keyed by metric id; null where a metric has no
   * value), so a draft can be critiqued against its reference reel (the 'reference' profile) on every row.
   */
  critiqueMetrics: z
    .record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), z.number().finite().nullable())
    .refine((metrics) => Object.keys(metrics).length <= 64, { message: 'At most 64 metrics' })
    .optional(),
});
export type TemplateListening = z.output<typeof templateListeningSchema>;

export const audioProfileSchema = z.object({
  kind: z.enum(AUDIO_KINDS),
  /** Integrated loudness (EBU R128); null when silent. */
  loudnessLufs: z.number().min(-70).max(5).nullable(),
  /**
   * The sound the platform credits, for "add this sound in the app" (G5 a). Untrusted text. BRK1-REV: the person
   * can write it (`template.setSoundCredit`), with an optional https link to the sound.
   */
  sound: z
    .object({
      title: z.string().max(200).nullable(),
      artist: z.string().max(200).nullable(),
      url: soundUrlSchema.nullable().optional(),
    })
    .nullable(),
  speech: z
    .object({
      language: languageTagSchema.nullable(),
      /** Share of the duration with speech. */
      coverage: unit,
      /** Untrusted text. */
      segments: z
        .array(z.object({ start: time, duration: time, text: z.string().min(1).max(1000) }))
        .max(400),
    })
    .nullable(),
  /** Peak envelope for the card's beat waveform: one value per unit of `rate` (50/1). */
  waveform: z.object({ rate: frameRateSchema, peaks: z.array(unit).max(12_000) }).nullable(),
  /** EAR1: what the breakdown heard; absent on templates made before it, null when it couldn't listen. */
  listening: templateListeningSchema.nullable().optional(),
});
export type AudioProfile = z.output<typeof audioProfileSchema>;
