// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The LIB1-LANG labelled set: what is fetched, and what each clip's right answer is. Nothing here is audio; the
 * clips are fetched by `fetch.ts` into a folder outside the repo and never committed.
 *
 * - FLEURS (google/fleurs, CC-BY-4.0, Conneau et al. 2022): read speech, the held-out test split, the first
 *   `perLanguage` utterances of each language's test tar in tar order.
 * - HumynLabs customer-support Hinglish audio (CC-BY-4.0): real phone recordings by Indian speakers, Hindi with
 *   English words, noisy on purpose. Their file names carry the speakers' names, so the clip list here is a rule (the
 *   first `perSet` files in name order), and the clips are numbered, never named.
 * - Synthetic slice-mixed: one FLEURS Hindi utterance then one English one. It tests "mixed from pieces"; it is
 *   labelled synthetic and is never a gate result.
 * - Local clips (owner-clips.json, outside the repo), reported by name, never committed.
 */
import { z } from 'zod';

export const FLEURS_LANGUAGES = {
  // The languages of India the identifier names, and their confusers.
  or_in: 'or',
  hi_in: 'hi',
  bn_in: 'bn',
  as_in: 'as',
  ne_np: 'ne',
  mr_in: 'mr',
  ta_in: 'ta',
  te_in: 'te',
  gu_in: 'gu',
  pa_in: 'pa',
  ur_pk: 'ur',
  en_us: 'en',
  // Languages the identifier can't name: the floor must not cost them their answer.
  es_419: 'es',
  fr_fr: 'fr',
  de_de: 'de',
  ar_eg: 'ar',
  vi_vn: 'vi',
  cmn_hans_cn: 'zh',
} as const;

export const HINGLISH_SETS = [
  'HumynLabs/airline-customersupport-Hinglish-audio',
  'HumynLabs/banking-customersupport-hinglish-audio',
  'HumynLabs/e-commerce-customersupport-hinglish-audio',
] as const;

export const LANGUAGE_SET = {
  perLanguage: 16,
  perSet: 20,
  synthetic: 8,
  /** Each clip is heard cropped to its first 2 s and 4 s of sound, and whole: phone clips are short. */
  crops: [2, 4, 0],
} as const;

/** What the right answer is: one language, or (Hinglish) Hindi or "Hindi and English". */
export const truthSchema = z.object({
  language: z.string().nullable(),
  /** Also right: a mix of exactly these (Hinglish: hi and en). */
  mix: z.array(z.string()).optional(),
});
export type Truth = z.infer<typeof truthSchema>;

export const clipSchema = z.object({
  id: z.string(),
  set: z.enum(['fleurs', 'hinglish', 'synthetic', 'owner']),
  /** The file under the eval folder, 16 kHz mono WAV. */
  file: z.string(),
  truth: truthSchema,
  /** Never a gate result (synthetic). */
  synthetic: z.boolean().optional(),
  /** Reported by name (local clips). */
  name: z.string().optional(),
  /** No right answer is known: reported, never scored. */
  unlabelled: z.boolean().optional(),
});
export type LanguageClip = z.infer<typeof clipSchema>;

/**
 * Clips that aren't in the repo and never will be (the owner's footage): listed in `owner-clips.json` in the folder
 * given to `fetch --owner`, each `{ name, file, truth? }` with `file` beside the list. Without a truth they are
 * reported by name, never scored; nothing about them is committed.
 */
export const localClipSchema = z.object({
  name: z.string(),
  file: z.string(),
  truth: truthSchema.optional(),
});
export const LOCAL_CLIPS_FILE = 'owner-clips.json';
