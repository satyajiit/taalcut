// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-K2: `sfx.searchSounds`' result card: the sound effects that fit a description, best first, from the SFX bank,
 * the bundled sound pack and the user's own short sounds. A snapshot of the search. Titles are the bank's or the
 * pack's names or the user's file names, and a credit is the recording's own line: plain text, never translated.
 * The verdict is the calibrated audio match's (LISTEN_VERDICTS); a hint (a genre, mood, instrument or voice query)
 * never gets one.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { LISTEN_VERDICTS } from '../audio/listening';
import { sfxBankSoundIdSchema } from '../audio/mix-commands';
import { idSchema } from '../basics/ids';
import { BUNDLED_LICENCES } from '../library/asset-provenance';
import { SFX_CATEGORIES } from '../timeline/mix';
import { base, runId } from './card-parts';

/** Where a found sound lives: the SFX bank, the bundled `sfx-pack`, or the user's library. */
export const SOUND_RESULT_SOURCES = ['bank', 'pack', 'library'] as const;
export type SoundResultSource = (typeof SOUND_RESULT_SOURCES)[number];
/** The most sounds one search returns. */
export const SOUND_RESULTS_MAX = 20;

/** One found sound. Each source names it its own way: a bank `soundId`, a pack `packItemId`, a library `assetId`. */
export const soundResultSchema = z
  .object({
    source: z.enum(SOUND_RESULT_SOURCES),
    /** A bank sound: what `sfx.addHits` takes in `soundIds`. */
    soundId: sfxBankSoundIdSchema.optional(),
    packItemId: z.string().min(1).max(64).optional(),
    assetId: idSchema<'Asset'>().optional(),
    title: z.string().min(1).max(120),
    /** Null for a library sound: Taalcut doesn't know its family. */
    family: z.enum(SFX_CATEGORIES).nullable(),
    /** Null for a hint. */
    verdict: z.enum(LISTEN_VERDICTS).nullable(),
    /** D23: z within LISTEN_BORDERLINE_Z of a verdict's start; absent when it isn't. */
    borderline: z.boolean().optional(),
    /** The calibrated z of the audio match (2 weak, 2.5 plausible, 3 strong). */
    z: z.number().min(-100).max(100),
    /** A bundled sound's licence (D22: MIT for a code-made bank sound, shown as "Code-made"; else CC0 1.0). */
    licence: z.enum(BUNDLED_LICENCES).optional(),
    /** The recording and recordist a fitted bank sound credits. */
    credit: z.string().min(1).max(300).optional(),
  })
  .superRefine((sound, ctx) => {
    const named = { bank: 'soundId', pack: 'packItemId', library: 'assetId' } as const;
    const key = named[sound.source];
    if (sound[key] === undefined)
      ctx.addIssue({ code: 'custom', message: `A ${sound.source} sound has its ${key}`, path: [key] });
    if (sound.source === 'library' && sound.licence !== undefined)
      ctx.addIssue({ code: 'custom', message: 'A library sound is the user’s own', path: ['licence'] });
  });
export type SoundResult = z.output<typeof soundResultSchema>;

/** EAR1-K2: the sounds `sfx.searchSounds` found, best first. */
export const soundResultsCardSchema = z.object({
  type: z.literal('soundResults'),
  ...base,
  runId: runId.optional(),
  /** What was searched, as asked (plain text). */
  query: z.string().min(1).max(300),
  sounds: z.array(soundResultSchema).max(SOUND_RESULTS_MAX),
});
