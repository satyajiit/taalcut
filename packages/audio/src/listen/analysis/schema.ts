// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one listening analysis is asked for and gives back (EAR1-F7), as plain data in core's EAR1 types, so the
 * same values are a job's input and output (`audio.listen.analyse`), a cache entry, and what render's QA, the
 * breakdown and the agent read. Times are from the start of what was analysed (the range's start, when one is given).
 */
import {
  audioSetLabelSchema,
  cutSyncReportSchema,
  frameRateSchema,
  listenModelSchema,
  rationalTimeSchema,
  RENDER_LISTENING_EVENTS_MAX,
  soundAuditReportSchema,
  soundCritiqueSchema,
  SOUND_CRITIQUE_PROFILES,
  soundEventSchema,
  soundMeasuresSchema,
  soundRealnessSchema,
  soundSectionSchema,
  soundTagSchema,
  templateListeningSchema,
  timeRangeSchema,
  CUT_SYNC_MAX_CUTS,
} from '@taalcut/core';
import { z } from 'zod';

/** What an analysis can run; each runs only when asked (cut sync runs whenever cuts are given). */
export const LISTEN_WANTS = [
  /** Loudness, peaks, spectrum and stereo (listen/dsp measure). */
  'measures',
  /** Hits and swells with their prominence (superflux onsets). */
  'events',
  /** CLAP sections with their hints and AST presence (models). */
  'sections',
  /** The musical key (in `measures`). */
  'key',
  /** earshot's beat grid and tempo (in `measures`). */
  'tempo',
  /** Clicks, clipping, DC, ringing and the rest (sfx check). */
  'audit',
  /** Real recording or code-synthesised (CLAP; lane A1's scorer). */
  'realness',
  /** Calibrated vocabulary tags, hints and AudioSet labels (CLAP and AST). */
  'tags',
] as const;
export type ListenWantKey = (typeof LISTEN_WANTS)[number];

export const listenWantSchema = z
  .object(
    Object.fromEntries(LISTEN_WANTS.map((key) => [key, z.boolean().optional()])) as {
      [K in ListenWantKey]: z.ZodOptional<z.ZodBoolean>;
    },
  )
  .strict();
export type ListenWant = z.output<typeof listenWantSchema>;

/** The parts that need a model (CLAP, and AST for tags and sections). */
export const wantsClap = (want: ListenWant): boolean => !!(want.tags || want.sections || want.realness);
export const wantsAst = (want: ListenWant): boolean => !!(want.tags || want.sections);

const cutsSchema = z.array(rationalTimeSchema).max(CUT_SYNC_MAX_CUTS);

/** A critique of the sound (EAR1-A1's critic): against the launch films, or the template reel's own sound. */
export const listenCritiqueRequestSchema = z.object({
  profile: z.enum(SOUND_CRITIQUE_PROFILES),
  reference: templateListeningSchema.optional(),
});
export type ListenCritiqueRequest = z.output<typeof listenCritiqueRequestSchema>;

/** Everything but the audio: what the cache key covers (with the models and the config version). */
export const listenOptionsSchema = z.object({
  range: timeRangeSchema.optional(),
  /** The picture's cuts, from the analysed audio's start: each gets a sync status. */
  cuts: cutsSchema.optional(),
  /** The music's beats (a beat map): events' and cuts' beat offsets. */
  beats: z.array(rationalTimeSchema).max(20_000).optional(),
  /** `ok` is one frame at this rate (40 ms without one). */
  frameRate: frameRateSchema.optional(),
  want: listenWantSchema,
  critique: listenCritiqueRequestSchema.optional(),
  /** Default true: a model not installed yet is downloaded; false fails (or, optional, skips) without downloading. */
  install: z.boolean().optional(),
  /**
   * A model that can't run here (not installed, no runtime) leaves the model parts null (`model: null`) instead of
   * failing the analysis: the signal-processing parts need none (render's QA).
   */
  optionalModels: z.boolean().optional(),
});
export type ListenOptions = z.output<typeof listenOptionsSchema>;

/** `audio.listen.analyse`'s input: a file the jobs process can read, and what to hear in it. */
export const listenAnalyseInputSchema = listenOptionsSchema.extend({
  /** An absolute path. */
  path: z.string().min(1).max(4096),
  /** The library's content hash when known (else the file's sha256 is taken): the cache key. */
  contentHash: z.string().min(1).max(128).optional(),
});
export type ListenAnalyseInput = z.output<typeof listenAnalyseInputSchema>;

/** describe's tags for the whole sound. */
export const soundTagsResultSchema = z.object({
  /** Validated tags, best first, each with its verdict. */
  tags: z.array(soundTagSchema).max(50),
  /** Genre, mood, instrument and voice: hints, never a verdict. */
  hints: z.array(soundTagSchema).max(50),
  audioSet: z.array(audioSetLabelSchema).max(5),
  /** AST's Music probability. */
  musicP: z.number().min(0).max(1).nullable(),
  /** Peak under −70 dBFS: nothing tagged. */
  nearSilent: z.boolean(),
  /** Under 5 ms: nothing tagged. */
  tooShort: z.boolean(),
  /** Quality words at z ≥ 2.5 ('bright', 'muffled'). */
  character: z.array(z.string().max(120)).max(5),
});
export type SoundTagsResult = z.output<typeof soundTagsResultSchema>;

/** One analysis: each part null (or empty) when it wasn't asked for or couldn't run. */
export const soundAnalysisSchema = z.object({
  measures: soundMeasuresSchema.nullable(),
  /** In time order; over RENDER_LISTENING_EVENTS_MAX, the most prominent are kept. */
  events: z.array(soundEventSchema).max(RENDER_LISTENING_EVENTS_MAX),
  sections: z.array(soundSectionSchema).max(200),
  /** When cuts were given. */
  cutSync: cutSyncReportSchema.nullable(),
  audit: soundAuditReportSchema.nullable(),
  tags: soundTagsResultSchema.nullable(),
  realness: soundRealnessSchema.nullable(),
  critique: soundCritiqueSchema.nullable(),
  /** The checkpoints the model parts came from; null when no model ran. */
  model: listenModelSchema.nullable(),
});
export type SoundAnalysis = z.output<typeof soundAnalysisSchema>;

export const EMPTY_ANALYSIS: SoundAnalysis = {
  measures: null,
  events: [],
  sections: [],
  cutSync: null,
  audit: null,
  tags: null,
  realness: null,
  critique: null,
  model: null,
};
