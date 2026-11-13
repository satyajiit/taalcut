// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music choice for a timeline (PRD G5 paths a to d; c, generated music,
 * since P3-V6). Stored on the Timeline (`timeline.music`), set with
 * `music.choosePath` (render-commands.ts, handled by @taalcut/timeline).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { DERIVED_KEY_PATTERN } from '../analysis/media-facts';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { platformSchema } from './presets';

export const MUSIC_PATHS = ['none', 'platformSound', 'ownTrack', 'referenceAudio', 'generated'] as const;
export type MusicPath = (typeof MUSIC_PATHS)[number];

/**
 * AcknowledgementStore feature for keeping the reference's audio (PRD 10.1).
 * @deprecated REF1 (2026-10-29): the reel's music needs no acknowledgement; nothing checks or records this any
 * more. It stays so stored records and older fixes still parse.
 */
export const REFERENCE_AUDIO_FEATURE = 'music.referenceAudio';
/**
 * Bump when the warning card's facts change; older acknowledgements stop counting.
 * @deprecated REF1 (2026-10-29): there is no warning card for the reel's music; see REFERENCE_AUDIO_FEATURE.
 */
export const REFERENCE_AUDIO_TERMS_VERSION = '1';

const gainDb = z.number().min(-60).max(12);

export const musicChoiceSchema = z.discriminatedUnion('path', [
  /** Keep the source sound without adding a music bed or platform instructions. */
  z.object({ path: z.literal('none') }),
  /** (a) No music in the file; the user adds the sound in the platform's app. */
  z.object({ path: z.literal('platformSound') }),
  /** (b) The user's own or licensed track; `offset` is the track time under frame 0. */
  z.object({
    path: z.literal('ownTrack'),
    assetId: idSchema<'Asset'>(),
    offset: rationalTimeSchema,
    gainDb,
  }),
  /**
   * (d) The reel's own music: the audio of the reel the template keeps on this Mac (REF1), from frame 0, where
   * the beat map's zero is. The default for a new timeline when the template keeps audio.
   */
  z.object({ path: z.literal('referenceAudio'), templateId: idSchema<'Template'>(), gainDb }),
  /** (c) Music generated for this timeline, warped onto its beat map (audio SPEC P3.5). */
  z.object({
    path: z.literal('generated'),
    /** The generated original, kept byte for byte. */
    assetId: idSchema<'Asset'>(),
    /** The warped 48 kHz FLAC the mixer plays (DERIVED_KINDS 'warpedMusic'). */
    warpedKey: z.string().regex(DERIVED_KEY_PATTERN),
    bpm: z.number().min(40).max(240),
    /** audio's grid check after the warp. */
    grid: z.object({
      maxErrorMs: z.number().nonnegative(),
      p95ErrorMs: z.number().nonnegative(),
      missed: z.number().min(0).max(1),
    }),
    gainDb,
  }),
]);
export type MusicChoice = z.infer<typeof musicChoiceSchema>;

/** What path (a) tells the user to do in each app; also what to do when the reel's music is turned off. */
export const platformSoundStepsSchema = z.object({
  /** The reference post, when it came from a link. */
  referenceUrl: z.url().nullable(),
  /** The sound's title and artist as the platform showed them, when known. Plain text. */
  soundLabel: z.string().max(200).nullable(),
  steps: z.array(z.object({ platform: platformSchema, stepKeys: z.array(z.string().min(1)).min(1).max(10) })),
});
export type PlatformSoundSteps = z.infer<typeof platformSoundStepsSchema>;
