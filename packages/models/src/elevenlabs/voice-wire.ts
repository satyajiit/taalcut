// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs voice answers, checked at the boundary: speech with character timings, the voice list and a new
 * instant clone. Voice names and labels are provider text (untrusted) and are only ever displayed.
 */
import type { CharacterAlignment, VoiceSummary } from '@taalcut/core';
import { z } from 'zod';

const alignmentSchema = z
  .object({
    characters: z.array(z.string()),
    character_start_times_seconds: z.array(z.number().nonnegative()),
    character_end_times_seconds: z.array(z.number().nonnegative()),
  })
  .refine(
    (a) =>
      a.characters.length === a.character_start_times_seconds.length &&
      a.characters.length === a.character_end_times_seconds.length,
    { message: 'alignment arrays differ in length' },
  );

export const speechSchema = z
  .object({
    audio_base64: z.base64().min(1),
    alignment: alignmentSchema.nullish(),
    normalized_alignment: alignmentSchema.nullish(),
  })
  .refine((s) => Boolean(s.alignment ?? s.normalized_alignment), { message: 'no alignment' });

/** `alignment` (the original text) when given, else `normalized_alignment`. */
export function characterAlignment(speech: z.output<typeof speechSchema>): CharacterAlignment {
  const source = speech.alignment ?? speech.normalized_alignment;
  return {
    characters: source?.characters ?? [],
    startSeconds: source?.character_start_times_seconds ?? [],
    endSeconds: source?.character_end_times_seconds ?? [],
  };
}

const voiceSchema = z.object({
  voice_id: z.string().min(1).max(64),
  name: z.string().max(200).nullish(),
  category: z.string().nullish(),
  labels: z.record(z.string(), z.string().nullable()).nullish(),
  verified_languages: z.array(z.object({ language: z.string() })).nullish(),
});

export const voicePageSchema = z.object({
  voices: z.array(voiceSchema),
  has_more: z.boolean().nullish(),
  next_page_token: z.string().nullish(),
});

export const cloneSchema = z.object({
  voice_id: z.string().min(1).max(64),
  requires_verification: z.boolean().nullish(),
});

/** Categories of voices the user made from their own recordings. */
const OWN_CATEGORIES = new Set(['cloned', 'professional']);

const base = (tag: string) => tag.toLowerCase().split('-')[0] ?? tag;

/** Voices speaking `language` (or saying nothing about it), as core's VoiceSummary. */
export function voiceSummaries(
  voices: z.output<typeof voiceSchema>[],
  language: string | undefined,
): VoiceSummary[] {
  return voices
    .filter((voice) => {
      if (!language) return true;
      const spoken = [
        ...(voice.verified_languages ?? []).map((v) => v.language),
        ...(voice.labels?.language ? [voice.labels.language] : []),
      ];
      return spoken.length === 0 || spoken.some((tag) => base(tag) === base(language));
    })
    .map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name?.trim() || voice.voice_id,
      labels: Object.fromEntries(
        Object.entries(voice.labels ?? {}).flatMap(([key, value]) => (value ? [[key, value]] : [])),
      ),
      own: OWN_CATEGORIES.has(voice.category ?? ''),
    }));
}
