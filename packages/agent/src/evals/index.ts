// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tone evals (SPEC section 22): what `tools/evals tone` calls. */
export {
  JUDGE_PROMPT_VERSION,
  judgeIsAuthor,
  judgeSystemPrompt,
  pairRequest,
  parsePairAnswer,
  parseRubricAnswer,
  pickJudge,
  RUBRIC,
  rubricRequest,
} from './tone-judge';
export { detectLanguage, JARGON, sentenceCount, toneMetrics, type ToneMetrics } from './tone-metrics';
export { pairSummary, type PairResult, type PairSummary } from './tone-pairs';
export {
  TONE_PASS,
  toneReport,
  type ProviderToneResult,
  type ToneFailure,
  type ToneReport,
  type ToneReportInput,
  type ToneStatus,
} from './tone-report';
export { runToneSession, TONE_AUTHORS, TONE_JUDGE, type ToneSessionInput } from './tone-session';
export {
  modelRefSchema,
  PAIR_WINNERS,
  perAxis,
  TONE_AXES,
  TONE_LANGUAGES,
  TONE_TRAPS,
  tonePromptSchema,
  tonePromptSetSchema,
  toneRecordingSchema,
  toneScoresSchema,
  TRAP_AXIS,
  type ModelRef,
  type PairWinner,
  type ToneAxis,
  type ToneLanguage,
  type TonePrompt,
  type TonePromptSet,
  type ToneRecording,
  type ToneScores,
  type ToneTrap,
} from './tone-types';
