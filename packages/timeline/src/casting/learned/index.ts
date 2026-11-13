// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Learned casting preferences (LRN1-PREF): pairs from the log, the learner, the config resolution, the job. What a
 * casting-weights item means (bounds, fit, text) is core's memory/casting-weights.ts.
 */
export {
  learnedCastingConfig,
  LEARNED_WEIGHTS_FILTER,
  staticCastingConfig,
  type CastingConfigSource,
  type CastingWeightsUsed,
  type LearnedCastingConfigDeps,
  type ResolvedCastingConfig,
} from './config-source';
export { foldLog, LEARNER_LOG_COMMANDS, LEARNER_ORIGIN, weightsOfData, type FoldedLog } from './fold';
export {
  learnCastingWeights,
  pairMargin,
  type LearnInput,
  type Learned,
  type PreferencePair,
  type ScoreParts,
} from './learner';
export { LEARNER_CONFIG, learnerConfigSchema, type LearnerConfig } from './learner-config';
export {
  createCastingLearner,
  followCastingSignals,
  type CastingLearner,
  type CastingLearnerDeps,
  type CastingSignalLog,
  type FollowOptions,
  type LearnOutcome,
  type LearnRun,
} from './learning-job';
export { hasScore, partsOf, signalPairs, SIGNAL_COMMANDS } from './signals';
