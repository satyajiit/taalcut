// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  buildCharacterAlignment,
  encodeWavPcm16,
  type AlignedWordTiming,
} from './alignment';
export {
  CHATTERBOX_BUILTIN_VOICES,
  CHATTERBOX_COMPONENT_SPECS,
  CHATTERBOX_LANGUAGES,
  CHATTERBOX_MODEL_ROLES,
  CHATTERBOX_MODELS,
  CHATTERBOX_PARALINGUISTIC_TAGS,
  CHATTERBOX_PROVIDER,
  CHATTERBOX_SAMPLE_RATE,
  CHATTERBOX_TEXT_LIMIT,
  chatterboxLanguageCode,
  prepareChatterboxText,
  type ChatterboxComponentSpec,
  type ChatterboxParalinguisticTag,
} from './spec';
export {
  createChatterboxVoice,
  createCompositeVoiceProvider,
  type ChatterboxCloneRecord,
  type ChatterboxEngine,
  type ChatterboxInferInput,
  type ChatterboxInferOutput,
  type ChatterboxVoiceDeps,
  type ChatterboxWordAligner,
  type CompositeVoiceProviderDeps,
} from './voice-provider';
