// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-X1: `audio.cloudCritique`, a consented second opinion on a sound from a hosted audio model (SPEC.md). */
export { CLOUD_CRITIQUE_TOOL, createCloudCritiqueTool, critiqueKey } from './tool';
export {
  AUDIO_INPUT_PROVIDERS,
  CLOUD_CRITIQUE_MODULE,
  critiqueSeconds,
  estimateCritiqueCost,
  pickCritiqueModel,
} from './model';
export { critiqueSummary, normaliseCritique, parseAnswerJson, secondsOf, type HeardClip } from './answer';
export { critiqueContext, type ClipWindow, type CritiqueFacts } from './context';
export { buildCritiquePrompt, type CritiquePromptInput } from './rubric';
export type {
  CloudCritiqueDeps,
  CritiqueAudio,
  CritiqueConsent,
  CritiqueSource,
  PreparedCritiqueAudio,
} from './ports';
export {
  CLOUD_CRITIQUE_KBPS,
  CLOUD_CRITIQUE_MAX_SECONDS,
  CLOUD_CRITIQUE_TIMEOUT_MS,
  cloudCritiqueInputSchema,
  cloudCritiqueOutputSchema,
  cloudCritiqueSchema,
  type CloudCritique,
  type CloudCritiqueInput,
  type CloudCritiqueOutput,
  type CritiqueIssue,
} from './schema';
