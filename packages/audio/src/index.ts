// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/audio: Beats, speech-to-text, loudness and audio type.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/audio' and never from a path inside src/.
 */
export { AUDIO_CONFIG, type HardwareTier } from './config';
export { createBeatTracker } from './beats/tracker';
export { createOrtBeatRuntime } from './beats/ort';
export { BEAT_DEVICES, beatDevicePlan, DEFAULT_BEAT_PLAN } from './beats/devices';
export type { BeatDevice, BeatDevicePlan } from './beats/types';
export { beatFrontEndGraph } from './beats/graph';
export { referenceLogMel } from './beats/frontend';
export { measureAudio } from './measure/measure';
export { classifyAudio } from './measure/classify';
export { createAudioJobs } from './jobs/handlers';
export {
  audioDetectLanguageJob,
  audioMeasureJob,
  audioTrackBeatsJob,
  audioTranscribeCloudJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
} from './jobs/kinds';
export { createCloudSpeechEngine, transcribeCloud, type SpeechSettings } from './speech/cloud-engine';
export { detectLanguage } from './speech/detect';
export { type SpeechEngine, type SpeechSidecar } from './speech/engine';
export { createFluidAudioEngine } from './speech/fluid-engine';
export { createParakeetSidecar, speechSidecarFromJsonLine } from './speech/parakeet-sidecar';
export { routeTranscription } from './speech/route';
export { createSherpaParakeetEngine } from './speech/sherpa-engine';
export { createWhisperEngine } from './speech/whisper-engine';
export { parseWhisperJson, wordsFromTokens } from './speech/whisper-parse';
export { audioToolModule } from './tools/module';
export { createAudioIndexJobs } from './jobs/index-handlers';
export {
  audioIdentifyLanguageJob,
  audioIndexJobKinds,
  audioTranscribeAssetJob,
  audioTranscribeAssetParakeetJob,
  audioTranscribeAssetWhisperJob,
  identifyLanguageOutputSchema,
  type IdentifyLanguageOutput,
} from './jobs/index-kinds';
export {
  AUDIO_SKIP,
  createAudioIndexStages,
  spokenLanguageOf,
  storedLanguage,
  untranscribable,
  transcriptEngine,
  type AudioIndexStageOptions,
} from './jobs/index-stages';
export type { AudioIndexJobDeps, AudioJobDeps } from './jobs/deps';
export {
  createAssetAudioStore,
  type AssetAudioStore,
  type AssetAudioStoreDeps,
} from './asset-audio/asset-audio-store';
export { speechPcmPort } from './asset-audio/speech-pcm-port';
export {
  ASR_BACKENDS,
  planAsrBackend,
  type AsrBackendOption,
  type AsrBackendPlan,
  type AsrMachine,
} from './speech/asr-backends';
export { createCliWhisperDecoder } from './whisper/cli-decoder';
export type { WhisperDecoder } from './whisper/decoder';
export {
  createWhisperServerPool,
  type WhisperServerPool,
  type WhisperServerPoolDeps,
} from './whisper/server-pool';
export { createServerRegistry, type ServerRegistry } from './whisper/server-registry';
export {
  createPosixServerSpawn,
  freeLoopbackPort,
  posixServerSpawn,
  type ServerSpawn,
} from './whisper/server-spawn';
export { EngineUnavailable, ModelMissing, NoAudio } from './errors';

// Phase 3 (P3-B6, P3-V6, P3-V9, P3-V20): voice, music, ducking, sound effects, speech cleanup, translation.
export type { TimelineWriteDeps } from './commands/timeline-writes';
export { createTimeStretcher, type StretcherDeps } from './stretch/select';
export type { TimeStretcher } from './stretch/stretcher';
export { createVoiceoverService, type VoiceoverService, type VoiceoverServiceDeps } from './voice/voiceover';
export {
  createSpeechWordAligner,
  wordsFromTranscript,
  type AlignedTranscriptWord,
  type SpeechWordAligner,
  type SpeechWordAlignerDeps,
} from './voice/local-aligner';
export { planPlacement, type PlacementLine, type PlacementResult } from './voice/placement';
export { createVoiceCommands } from './voice/voice-commands';
export {
  createConsentCommands,
  type ConsentCommandDeps,
  type VoiceCaptureFiles,
} from './voice/consent-commands';
export { CONSENT_LISTEN_MS, type LocalTranscriber } from './voice/consent';
export { consentLine, hasConsentLine } from './voice/consent-lines';
export { gridFromBeatMap, type BeatGrid } from './music/beat-grid';
export { createMusicGenerator, type MusicGeneratorDeps } from './music/generate-track';
export { loadMusicPack, type MusicPack } from './music/library-catalogue';
export { createMusicLibrary, type MusicLibrary, type MusicPackSource } from './music/library-service';
export { musicLibraryTools, type MusicLibraryToolDeps } from './tools/music-library-tools';
export { describeTracks, type LibraryMusic, type MusicDescribeDeps } from './music/library-describe';
export { listenSearchTools, LISTEN_TOOL, type ListenSearchToolDeps } from './tools/listen-search-tools';
export { searchSoundsTool, type LibrarySound, type SfxSearchToolDeps } from './tools/sfx-search-tool';
export type { ListenAssetFiles } from './tools/listen-sources';
export type { DerivedFileWriter, MusicBeatTracker } from './music/warp-track';
export { createDuckingPlanner, type DuckingPlannerDeps } from './mix/ducking-planner';
export { createDuckingCommand } from './mix/ducking-command';
export { createLoudnessMeter, type LoudnessMeter } from './mix/loudness-series';
export { createSfxService, type SfxPackSource, type SfxServiceDeps } from './sfx/hits-service';
export { createSfxCommands } from './sfx/hits-command';
export { loadSfxPack, type SfxPack } from './sfx/pack-catalogue';
export { MusicLibraryEmpty } from './music/errors';
export { SfxPackMissing } from './sfx/errors';
// EAR1-D1/D2/D3: the SFX bank (the `sfx-bank` component's catalogue, its takes and CLAP embeddings) and kits.
export {
  loadSfxBank,
  sfxBankSource,
  type SfxBank,
  type SfxBankEmbeddings,
  type SfxBankQuery,
  type SfxBankSource,
} from './sfx/bank-source';
export type { SfxBankCatalogue, SfxBankItem, SfxBankTake } from './sfx/bank-catalogue';
export {
  CloudCritiqueConsentRequired,
  KitInvalid,
  ReelSfxUnavailable,
  SfxBankMissing,
} from './listen/errors';
export { KIT_PRESETS, kitPreset, type KitPreset } from './sfx/kits/presets';
export { parseKit, type Kit, type KitRole } from './sfx/kits/schema';
export { lockKit, planKit, type KitLock, type LockRole, type LockTake } from './sfx/kits/lock';
export type { PlannedTake, TakeAudio, TakeRenderDeps } from './sfx/kits/render-take';
// EAR1-C2 (lane C): a template reel's effects put on the same cuts from the bank (templates' sound/reel-sfx.ts).
export { bankHitRecords, bankPick, importBankTakes, plainTakes, type BankPick } from './sfx/bank-hits';
export { HIT_CONFIG, placeHit, withoutOverlaps, type HitTarget, type PlannedHit } from './sfx/hit-plan';
export { createSileroVad, type VadEngine } from './cleanup/vad';
// LIB1-LANG: the Indian-language identifier and the language decision.
export {
  createIndicLid,
  INDIC_LID,
  INDIC_LID_LABELS,
  softmaxScores,
  voicePieces,
  type IndicLid,
} from './speech/indic-lid';
export {
  aggregatePieces,
  decideLanguage,
  identifierNames,
  LANGUAGE_DECISION,
  withPrior,
  type IdentifiedPiece,
  type LanguageDecision,
  type LanguageDecisionConfig,
  type LanguageEvidence,
  type LanguageScore,
} from './speech/language-decision';
export { fromWhisperCode, whisperCodeFor, WHISPER_LANGUAGES } from './speech/whisper-languages';
export { identifyCascade, whisperScores, type CascadeResult } from './jobs/identify-cascade';
export { createSpeechCleanupAnalyser, type SpeechCleanupAnalyser } from './cleanup/analysis';
export {
  audioAnalyzeSpeechJob,
  createCleanupJobs,
  type AnalyzeSpeechDeps,
  type SpeechAssetReader,
} from './cleanup/analyze-job';
export { createSpeechCleanupSource, type AssetHashes } from './cleanup/cleanup-source';
export type { DerivedJson } from './cleanup/speech-files';
export { createCaptionTranslator, type CaptionTranslator } from './translate/caption-translator';
export type { GenerationPrices } from './tools/prices';
export { voiceToolModule } from './tools/voice-read-tools';
export type { VoiceToolDeps } from './tools/voice-tools';
export { musicGenerationToolModule, musicGenerationTools, type MusicToolDeps } from './tools/music-tools';
export { sfxToolModule, type SfxToolDeps } from './tools/sfx-tools';
export { cleanupTools, type CleanupToolDeps } from './tools/cleanup-tools';
export { translateToolModule, type TranslateToolDeps } from './tools/translate-tools';
export { createVoiceSkillModule, VOICE_DIRECTOR_TOOLS, type VoiceSkillDeps } from './skills/voice-director';
export type { TranscriptReader } from './skills/voice-coverage';
export { VOICE_DIRECTOR_SKILL_ID, type TakesCost } from './skills/voice-card';

export { audioEditorCapabilities } from './editor-capabilities';
export {
  measureBs1770Loudness,
  normalisePcmToLufs,
  solveStemLoudnorm,
  type Bs1770Measurement,
} from './mix/bs1770-loudnorm';
export { encodePcm16Wav, synthesizeProceduralSfx, type SynthesizedSfx } from './synth/tone-synth';
export {
  buildGrooveGrid,
  snapTimeToGroove,
  type GrooveGrid,
  type GroovePoint,
  type SnapGrooveResult,
} from './beats/groove-grid';
export {
  createRecommendDspChainTool,
  createSnapToGrooveTool,
  createSynthesizeSfxTool,
  recommendDspChainInputSchema,
  recommendDspChainOutputSchema,
  snapToGrooveInputSchema,
  snapToGrooveOutputSchema,
  synthesizeProceduralSfxOutputSchema,
} from './tools/dsp-synth-tools';

// EAR1 (plan/earshot-round-1.md): listening, earshot's layer ported (listen/api.ts lists it, SPEC "EAR1 jobs and
// wiring"): F4 models, F5 calibration and semantics, F6 DSP and sync, F7 analysis, cache, jobs and the SoundListener.
export * from './listen/api';
