// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { reelsFromCsv, reelsToCsv, parseCsv, CSV_COLUMNS } from './csv';
export { evaluateDirs, loadGoldenDir, loadPrediction } from './evaluate';
export { CUT_TOLERANCE_FRAMES, matchCuts } from './match';
export { REEL_BAR, cutScores, scoreAll, scoreReel } from './metric';
export { jsonPathFor, renderJson, renderMarkdown } from './report';
export {
  audioTypeSchema,
  frameRateSchema,
  goldenJsonSchema,
  goldenReelSchema,
  parseGoldenReel,
  parsePredictionReel,
  predictionReelSchema,
} from './schema';
export { stubPrediction } from './stub';
export type {
  BreakdownInput,
  BreakdownSystem,
  CastingCaseInput,
  CastingSystem,
  CastingVariant,
  CastingWeights,
  EvalShot,
  FrameRange,
  PerfMeasureInput,
  PerfSample,
  PerfSystem,
  RenderOutput,
  RenderRequest,
  RenderSystem,
  SearchQuery,
  SearchSystem,
} from './adapters/types';
export { compareEnvelopes, compareFiles, envelopeOf, renderCompare } from './compare';
export type { CompareReport, CompareRow } from './compare';
export type { MetricPoint, SuiteEnvelope } from './envelope';
export { GATE3_REEL_SHARE } from './metric';
export type { Gate3 } from './metric';
export { firstMatchIndex, overlapShare, shotsMatch } from './shot-match';
export { librarySearchSystem } from './adapters/search';
export { syntheticSearchSystem } from './adapters/synthetic-search';
export { timelineCastingSystem } from './adapters/casting';
export { syntheticCastingSystem } from './adapters/synthetic-casting';
export { templateBreakdownSystem } from './adapters/breakdown';
export { syntheticBreakdownSystem } from './adapters/synthetic-breakdown';
export { exportRenderSystem } from './adapters/render';
export { syntheticRenderSystem } from './adapters/synthetic-render';
export { runnerPerfSystem } from './adapters/perf';
export { syntheticPerfSystem } from './adapters/synthetic-perf';
export { scoreSearch } from './search/run';
export { scoreCasting } from './casting/run';
export { tuneCasting } from './casting/tune';
export { scoreBreakdown } from './breakdown/run';
export { buildRenderReport } from './render/run';
export { runPerf } from './perf/run';
export { scoreReframe } from './reframe/run';
export { scoreVariants } from './variants/run';
export { scoreVoice } from './voice/run';
export { scoreRouter } from './router/run';
export { scoreInterchange } from './interchange/run';
export { scoreCleanup } from './cleanup/run';
export { GATE_METRICS } from './gates/catalog';
export { buildReport as buildGateReport } from './gates/report/build';
export { runSmoke } from './soak/smoke';
export { parseUsabilitySession } from './usability/schema';
export { summarise as summariseUsability } from './usability/summary';
