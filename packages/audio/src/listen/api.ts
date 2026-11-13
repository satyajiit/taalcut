// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening layer's public surface (EAR1), re-exported whole by the package's index.ts: F4's models and device
 * plan, F5's calibration, describe/match/rank/compare and sections, F6's DSP, events and cut sync, and F7's
 * analysis, cache, jobs, service and SoundListener. A lane adds its own exports here (critique, realness, search).
 */
export { LISTEN_CONFIG } from './config';
export {
  ListenBadInput,
  ListenFailed,
  ListenModelMissing,
  ListenNearSilent,
  ListenUnavailable,
} from './errors';
export {
  DEFAULT_LISTEN_PLAN,
  LISTEN_DEVICES,
  LISTEN_OPERATIONS,
  listenDevicePlan,
  type ListenDevice,
  type ListenDevicePlan,
  type ListenOperation,
} from './models/devices';
export {
  directoryListenFiles,
  dtypeOfComponent,
  installedListenFiles,
  type InstalledListenFilesOptions,
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
  type ResolvedListenModel,
} from './models/files';
export {
  createListenSessions,
  type ListenSessions,
  type ListenSessionsOptions,
  type ListenTimers,
} from './models/sessions';
export { createListenRuntime, embedAudioFile, embedPcm, type ListenRuntime } from './models/embed';
export { createClapAudio, type ClapAudioEncoder, type ClapSourceEmbedding } from './models/clap-audio';
export { createClapText, type ClapTextEncoder } from './models/clap-text';
export { createAstTagger, type AstResult, type AstTagger } from './models/ast';
export { decodeListenAudio, timelineMono, type ListenPcm } from './models/pcm';
export { createListenText, type EmbeddedPhrases, type ListenText } from './calibrate/text';
export { calibrate, type SoundCalibration } from './calibrate/score';
export {
  scoreQueries,
  topTerms,
  toSoundTag,
  type EmbeddedText,
  type QueryScore,
  type TermScore,
} from './calibrate/match';
export { isBorderline, verdictFor, verdictOf } from './calibrate/verdict';
export type { ListenVocab } from './calibrate/vocab';
export {
  EVENT_ANCHORS,
  EVENT_VOCAB,
  REALNESS_PROMPTS,
  TAG_TEMPLATES,
  TEXTURE_ANCHORS,
} from './calibrate/phrase-sets';
export {
  createListenModels,
  type ListenModels,
  type ListenModelsOptions,
  type ListenRange,
  type ListenSource,
} from './describe/context';
export { describeSound, type DescribeOptions, type SoundDescription } from './describe/describe';
export { matchSound, type MatchOptions, type SoundMatch } from './describe/match';
export { rankSounds, type RankedSource, type SoundRanking } from './describe/rank';
export {
  abSounds,
  compareSound,
  differences,
  type AbComparison,
  type CompareFeatures,
  type SoundComparison,
} from './describe/compare';
export { listenSections, toSoundSection, type ListenSection, type SectionsResult } from './timeline/sections';
export { LISTEN_SR, monoOf, stereoOf, type ListenAudio, type Stereo } from './dsp/pcm';
export {
  createSpectrogramRunner,
  LISTEN_FRONTEND_OPERATION,
  type SpectrogramRunner,
  type SpectrogramRunnerOptions,
} from './dsp/spectrogram-graph';
export {
  analyseEvents,
  toSoundEvents,
  withBeatOffsets,
  type EventAnalysis,
  type EventOptions,
  type ListenEvent,
} from './timeline/events';
export {
  syncToCuts,
  toCutSyncReport,
  type CutAnswer,
  type SyncOptions,
  type SyncResult,
} from './timeline/sync';
export { chanceShare } from './timeline/chance';
export { musicGrid, type MusicGrid } from './dsp/tempo-grid';
export { estimateKey, type KeyCandidate } from './dsp/key';
export { timelineLoudness, type TimelineLoudness } from './dsp/loudness-timeline';
export { measureSound, toSoundMeasures, type Measurements, type MeasureOptions } from './dsp/measure';
export { AUDIT_KINDS, auditSound, toSoundAuditReport, type AuditContext, type SoundAudit } from './dsp/audit';
export { takeTimes, type TakeTimes } from './dsp/audit-shape';
export {
  EMPTY_ANALYSIS,
  LISTEN_WANTS,
  listenAnalyseInputSchema,
  listenCritiqueRequestSchema,
  listenOptionsSchema,
  listenWantSchema,
  soundAnalysisSchema,
  soundTagsResultSchema,
  type ListenAnalyseInput,
  type ListenCritiqueRequest,
  type ListenOptions,
  type ListenWant,
  type ListenWantKey,
  type SoundAnalysis,
  type SoundTagsResult,
} from './analysis/schema';
export { decodeListenSource, listenSourceOf, sliceListenAudio, type DecodedListen } from './analysis/source';
export {
  createListenAnalysisCache,
  fileContentHash,
  LISTEN_CACHE_DIR,
  listenCacheKey,
  pcmContentHash,
  type ListenAnalysisCache,
} from './analysis/cache';
export {
  analyseSound,
  LISTEN_CHECKPOINTS,
  type AnalyseSoundRequest,
  type ListenAnalysisDeps,
  type ListenModelSet,
} from './analysis/analyse';
export {
  defineListenQuery,
  LISTEN_EXTENSIONS,
  type CritiqueInput,
  type ListenExtensions,
  type ListenPassInput,
  type ListenQueryContext,
  type ListenQueryOp,
  type RealnessScorer,
  type SoundCritic,
} from './analysis/extensions';
export {
  BUILT_IN_LISTEN_QUERIES,
  compareQuery,
  describeQuery,
  listenSourceRefSchema,
  matchQuery,
  rankQuery,
  type ListenSourceRef,
} from './analysis/queries';
export { createListenService, type ListenService, type ListenServiceOptions } from './analysis/service';
export {
  audioListenAnalyseJob,
  audioListenQueryJob,
  createListenJobs,
  LISTEN_JOB_LANE,
  listenQueryInputSchema,
  runListenAnalyse,
  runListenQuery,
  type ListenJobDeps,
  type ListenQueryInput,
} from './jobs';
export {
  createJobSoundListener,
  createSoundListener,
  RENDER_LISTEN_WANT,
  renderListenOptions,
  toRenderListening,
  type HearOptions,
  type JobHearRenderInput,
  type JobSoundListener,
  type JobSoundListenerOptions,
} from './listener';
// EAR1-B1/B2/B3: search (find, the sound index, lane B's query operations, embeddings and the searcher).
export {
  FIND_KINDS,
  findMoments,
  queryKindOf,
  type FindKind,
  type FindOptions,
  type FoundMoment,
  type FoundMoments,
  type QueryKind,
  type SpanEmbeddings,
} from './describe/find';
export {
  createSoundIndex,
  embedNames,
  searchSoundIndex,
  type IndexedSound,
  type SoundHit,
  type SoundIndex,
  type SoundSearch,
  type TermHint,
} from './search/sound-index';
export {
  BANK_TITLES_OP,
  bankTitlesQuery,
  bankTitleSet,
  embedSoundsQuery,
  findMomentQuery,
  LISTEN_SEARCH_QUERIES,
  searchSoundsQuery,
  type EmbeddedSound,
  type SearchEntry,
  type SearchSoundsHit,
  type SearchSoundsResult,
} from './search/queries';
export { decodeEmbedding, encodeEmbedding } from './search/codec';
// EAR1-G2: the bank titles' text embeddings, kept in the derived cache.
export {
  createTitleEmbeddings,
  SFX_BANK_TITLE_SET,
  titleCacheKey,
  type TitleEmbeddings,
  type TitleEmbeddingsDeps,
  type TitleSet,
  type TitleTextBuild,
} from './search/title-cache';
export {
  createSoundEmbeddings,
  embeddingKey,
  type EmbeddableSound,
  type SoundEmbeddings,
} from './search/embedding-cache';
export { createSoundSearcher, type SoundSearcher, type SoundSearchRequest } from './search/sound-search';
// EAR1-C1 (lane C): a reel's own critique metrics, kept with its template (core's TemplateListening.critiqueMetrics).
export { audioPass, type AudioPass } from './critique/audio-pass';
export { filmMetrics, type FilmInput, type FilmMetrics, type FilmPicture } from './critique/film';
export { FILM_METRIC_IDS, type FilmMetricId } from './critique/profile';
export { musicWindows, type MusicWindow } from './critique/metrics-time';
// EAR1-A1/A2 (lane A): the sound critique and realness, and their analysis plug-ins (LISTEN_EXTENSIONS).
export { createSoundCritic, type SoundCriticOptions } from './critique/critic';
export {
  critiqueSound,
  toSoundCritique,
  type CritiqueInput as CritiqueSoundInput,
  type CritiqueResult,
  type NotMeasuredReason,
} from './critique/critique';
export { CRITIQUE_MESSAGE_KEYS, type CritiqueCommands } from './critique/fixes';
export {
  aggregateProfile,
  launchProfile,
  leaveOneOut,
  profileFromJson,
  profileFromListening,
  referenceMatch,
  type CritiqueProfile,
} from './critique/profile';
export { CRITIQUE_SPEC, type CritiqueRowId, type ScoreRow } from './critique/scorecard';
export {
  isRealnessBorderline,
  REALNESS_BORDERLINE,
  realnessFromSound,
  realnessOf,
  toSoundRealness,
  type RealnessEmbedder,
  type RealnessResult,
} from './realness/realness';
export { realnessModel, realnessPrompts } from './realness/model';
export { createRealnessScorer } from './realness/scorer';
// EAR1-A3 (lane A): the listening tools (audio.listen, audio.compare, audio.critique) and the `ab` query.
export { critiqueTool } from '../tools/critique-tool';
export { listenTools } from '../tools/listen-tools';
export type { ListenQaToolDeps } from '../tools/listen-tool-sources';
export { abQuery, type AbQueryResult } from './describe/ab-query';
export { compareFeatures } from './describe/compare-features';
// EAR1-I3: tools/evals' listen-parity (calibration on upstream's text rows; critique tolerances by unit).
export { createVocab } from './calibrate/vocab';
export { FILM_METRICS } from './critique/profile';
