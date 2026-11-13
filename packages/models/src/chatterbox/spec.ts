// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Resemble AI Chatterbox on-device text-to-speech (WP-VO-LOCAL): model ids, hardware tiers, paralinguistic tags,
 * built-in voice embeddings and component specs. Runs locally on ONNX Runtime (Core ML / Neural Engine, CUDA,
 * DirectML, WebGPU, CPU fallback) under the MIT licence, so voiceovers and zero-shot voice clones work in Local only
 * mode with US$0 cloud cost.
 */
import type { SpokenLanguage, VoiceSummary } from '@taalcut/core';
import type { HardwareTier } from '../hardware/types';

export const CHATTERBOX_PROVIDER = 'resemble';

export const CHATTERBOX_MODELS = {
  draft: 'chatterbox-turbo',
  final: 'chatterbox-multilingual',
} as const;

export const CHATTERBOX_MODEL_ROLES: Readonly<Record<string, 'draft' | 'final' | 'both'>> = {
  [CHATTERBOX_MODELS.draft]: 'draft',
  [CHATTERBOX_MODELS.final]: 'final',
};

export const CHATTERBOX_SAMPLE_RATE = 24_000;
export const CHATTERBOX_TEXT_LIMIT = 5_000;

/** Paralinguistic vocal tags Chatterbox-Turbo synthesises natively as non-verbal vocalisations. */
export const CHATTERBOX_PARALINGUISTIC_TAGS = [
  '[laugh]',
  '[chuckle]',
  '[sigh]',
  '[gasp]',
  '[cough]',
] as const;
export type ChatterboxParalinguisticTag = (typeof CHATTERBOX_PARALINGUISTIC_TAGS)[number];

const TAG_REGEX = /\[(?:laugh|chuckle|sigh|gasp|cough)\]/gi;

/**
 * Prepares script text for the selected Chatterbox model: `chatterbox-turbo` natively renders paralinguistic tags
 * (`[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[cough]`), whereas `chatterbox-multilingual` strips them so they are
 * never read aloud as literal bracketed words.
 */
export function prepareChatterboxText(
  text: string,
  model: string,
): { readonly promptText: string; readonly spokenText: string; readonly tags: readonly string[] } {
  const tags = (text.match(TAG_REGEX) ?? []).map((tag) => tag.toLowerCase());
  const stripped = text.replace(TAG_REGEX, ' ').replace(/\s{2,}/g, ' ').trim();
  const supportsTags = model === CHATTERBOX_MODELS.draft;
  return {
    promptText: supportsTags ? text.trim() : stripped,
    spokenText: stripped.length > 0 ? stripped : text.trim(),
    tags,
  };
}

/** Languages supported by Chatterbox Multilingual 0.5B (includes Taalcut's four v1 languages: en, hi, es, pt-BR). */
export const CHATTERBOX_LANGUAGES: readonly string[] = [
  'ar',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'he',
  'hi',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'pt-BR',
  'ru',
  'sv',
  'sw',
  'tr',
  'zh',
];

/** Built-in preset voice embeddings shipped with the Chatterbox component pack (`own: false`). */
export const CHATTERBOX_BUILTIN_VOICES: readonly VoiceSummary[] = [
  {
    voiceId: 'cb_aria_en',
    name: 'Aria (Warm Narrator)',
    labels: { language: 'en', style: 'narrative', gender: 'female' },
    own: false,
  },
  {
    voiceId: 'cb_marcus_en',
    name: 'Marcus (Dynamic Creator)',
    labels: { language: 'en', style: 'conversational', gender: 'male' },
    own: false,
  },
  {
    voiceId: 'cb_kavya_hi',
    name: 'Kavya (Hindi Storyteller)',
    labels: { language: 'hi', style: 'conversational', gender: 'female' },
    own: false,
  },
  {
    voiceId: 'cb_mateo_es',
    name: 'Mateo (Spanish Presenter)',
    labels: { language: 'es', style: 'upbeat', gender: 'male' },
    own: false,
  },
  {
    voiceId: 'cb_clara_pt',
    name: 'Clara (Brazilian Portuguese)',
    labels: { language: 'pt-BR', style: 'warm', gender: 'female' },
    own: false,
  },
];

export interface ChatterboxComponentSpec {
  readonly id: string;
  readonly model: string;
  readonly name: string;
  readonly version: string;
  readonly spdx: 'MIT';
  readonly tiers: readonly HardwareTier[];
  readonly dependencies: readonly string[];
}

export const CHATTERBOX_COMPONENT_SPECS: readonly ChatterboxComponentSpec[] = [
  {
    id: 'chatterbox-turbo-onnx',
    model: CHATTERBOX_MODELS.draft,
    name: 'Chatterbox Turbo 350M (ONNX)',
    version: '1.0.0',
    spdx: 'MIT',
    tiers: ['minimum', 'recommended', 'high'],
    dependencies: ['onnxruntime'],
  },
  {
    id: 'chatterbox-multilingual-onnx',
    model: CHATTERBOX_MODELS.final,
    name: 'Chatterbox Multilingual 0.5B (ONNX)',
    version: '1.0.0',
    spdx: 'MIT',
    tiers: ['recommended', 'high'],
    dependencies: ['onnxruntime'],
  },
];

/** Normalises a BCP-47 language tag ('pt-BR' → 'pt') for matching voice labels and multilingual model codes. */
export function chatterboxLanguageCode(language: SpokenLanguage | string): string {
  return (language.toLowerCase().split('-')[0] ?? language).slice(0, 3);
}
