// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listen-mood eval's manifest (EAR1-B3): 30 music tracks, each with one mood label from earshot's 16
 * `music_mood` terms, downloaded at eval time and never committed. Only CC0 1.0 audio is accepted (no CC BY-NC, no
 * API key that limits use): `licence` must be `CC0-1.0` and `licenceUrl` the CC0 deed, and the file is checked
 * against its sha256 and size before it is read. `labelledBy` says who chose the mood (a person, the publisher's
 * own tag) and is reported with the result.
 *
 * {
 *   "version": 1,
 *   "tracks": [
 *     { "id": "t01", "title": "…", "url": "https://…/t01.mp3", "sha256": "<64 hex>", "bytes": 1234567,
 *       "licence": "CC0-1.0", "licenceUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
 *       "source": "https://… (the page that dedicates it)", "mood": "calm and relaxing music",
 *       "labelledBy": "the publisher's mood tag" }
 *   ]
 * }
 */
import { z } from 'zod';

/** vocab.json `music_mood` at ff41f07 (third_party/earshot/data). */
export const MOOD_TERMS = [
  'uplifting and hopeful music',
  'playful and quirky music',
  'dark and tense music',
  'sad and melancholic music',
  'calm and relaxing music',
  'energetic and driving music',
  'dreamy and ethereal music',
  'triumphant and heroic music',
  'mysterious music',
  'romantic music',
  'aggressive music',
  'warm and cozy music',
  'futuristic music',
  'confident and cool music',
  'suspenseful build-up music',
  'celebratory and joyful music',
] as const;

export const moodTrackSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(200),
    url: z.url().refine((u) => u.startsWith('https://'), 'https only'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.int().positive().max(100_000_000),
    licence: z.literal('CC0-1.0'),
    licenceUrl: z.literal('https://creativecommons.org/publicdomain/zero/1.0/'),
    source: z.url(),
    mood: z.enum(MOOD_TERMS),
    labelledBy: z.string().min(1).max(200),
  })
  .strict();

export const moodManifestSchema = z
  .object({ version: z.literal(1), tracks: z.array(moodTrackSchema).min(30).max(200) })
  .strict()
  .refine((m) => new Set(m.tracks.map((t) => t.id)).size === m.tracks.length, 'track ids must be unique');

export type MoodTrack = z.output<typeof moodTrackSchema>;
export type MoodManifest = z.output<typeof moodManifestSchema>;
