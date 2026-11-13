// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  createElevenLabsSession,
  type ElevenLabsSession,
  type ElevenLabsSessionDeps,
} from './session';
export type { ElevenLabsHttp, ElevenLabsHttpDeps, KeyState } from './http';
export { createElevenLabsVoice, type ElevenLabsVoiceDeps } from './voice-provider';
export { createElevenLabsMusic, type ElevenLabsMusicDeps } from './music-provider';
export { createElevenLabsSfx, type ElevenLabsSfxDeps } from './sfx-provider';
export { ELEVENLABS_MODELS, ELEVENLABS_PROVIDER, OUTPUT_FORMATS } from './config';
export {
  ELEVENLABS_PRICES,
  elevenLabsCost,
  elevenLabsPrice,
  type ElevenLabsPrice,
} from './prices';
export { ModelPlanRequired, MusicPlanInvalid } from './errors';
