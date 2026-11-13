// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/**
 * @taalcut/render: HyperFrames compositions, timeline to frames to FFmpeg.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/render' and never from a path inside src/.
 */
// Errors, ports and shared types.
export * from './errors';
export { createCoverExportCommand } from './cover/cover-command';
export type { AssetFiles, ReferenceAudioSource, TimelineAccess, TranscriptSource } from './ports';
export type { ReferenceCredit } from './ports';
export type {
  CaptionFontId,
  CompositionFonts,
  CueLayout,
  FontFaceFile,
  ProbedTextBox,
  ProbedWord,
  QaAudioWindow,
  QaPlan,
  TextMeasure,
  TextMeasurer,
  PopRoom,
} from './types';
// Frame maths, plans and presets.
export {
  SUPPORTED_RATES,
  boundarySeconds,
  durationSeconds,
  frameMs,
  frameNanos,
  framesAt,
  isSupportedRate,
  mediaStartSeconds,
  rateLabel,
  samplesForFrames,
  toFrame,
  windowSeconds,
} from './time/frames';
export { meanSpeed, planTimeline, transitionEffect } from './plan/render-plan';
export { MAX_AUDIO_WINDOWS, planQa } from './plan/qa-plan';
export { POP_ORIGIN_Y, POP_PEAK_FRAMES, POP_SCALE } from './captions/pop';
export {
  TRANSITION_EFFECTS,
  type FrameSpan,
  type PlannedAudioClip,
  type PlannedText,
  type PlannedTransition,
  type PlannedVisual,
  type RenderPlan,
  type TransitionEffect,
} from './plan/types';
export {
  BUILT_PRESET_IDS,
  builtPresetIdSchema,
  DEFAULT_PRESET_ID,
  defaultPresetFor,
  EXPORT_PRESETS,
  intersectRects,
  presetAvailability,
  presetCodecs,
  presetFor,
  presetInCodec,
  safeRectFor,
  safeZoneProvenance,
  videoBitrateKbps,
} from './presets/presets.v1';
export {
  checkExportCodec,
  CODEC_REASON_KEYS,
  codecAvailability,
  presetCodecAvailability,
  type CodecAvailability,
} from './presets/codecs';
// The composition compiler.
export {
  COMPOSITION_ID,
  compileComposition,
  estimateCueLayout,
  type BundleLink,
  type CompileOptions,
  type CompositionBundle,
  type CompositionMediaEntry,
} from './compile/composition';
// The engine: exports, frames, previews and the pinned shell.
export {
  createRenderEngine,
  PREVIEW_SWEEP_MS,
  type RenderEngine,
  type RenderEngineOptions,
} from './engine/engine';
export type { RenderEngineDeps, RenderFolders } from './engine/deps';
export { EXPORT_MAX_ATTEMPTS, runExport, workFolder, type ExportCallOptions } from './engine/export-run';
export { createLiveRenders, PROGRESS_INTERVAL_MS, type LiveRenders } from './engine/live';
export {
  createProgressTracker,
  EXPORT_STAGES,
  STAGE_WEIGHTS,
  stageKey,
  type ExportStage,
} from './engine/progress';
export { COLOUR_BSF, finishRender, type FinishInput, type FinishResult } from './engine/finish';
export { renderVideo, type RenderedVideo, type RenderVideoInput } from './engine/render-video';
export {
  CONFORM_RECIPE,
  conformKey,
  fitSize,
  TAIL_FRAMES,
  type ConformedSegment,
  type ConformSource,
} from './engine/conform';
export {
  HEADLESS_SHELL,
  HEADLESS_SHELL_DELIVERY,
  headlessShellCandidates,
  renderPackageDir,
  resolveHeadlessShell,
  type HeadlessShellDelivery,
  type HeadlessShellSources,
} from './engine/headless-shell';
export { captureFrame, type CaptureFrameOptions } from './engine/capture-frame';
export {
  createPreviewSessions,
  PREVIEW_IDLE_MS,
  PREVIEW_MANIFEST,
  type MediaFolder,
  type PreviewSessions,
  type PreviewSessionsOptions,
} from './engine/previews';
// The renders router (UTILITY_CONTRACTS.render.renders).
export {
  rendersRouter,
  subtitleFileName,
  watchRenders,
  WATCH_POLL_MS,
  type RendersRouterOptions,
} from './router/renders-router';
export { listSnapshots, snapshotOf } from './router/snapshot';
export { ESTIMATE, estimateExport, exportOptions, type ExportOptionsDeps } from './router/export-options';
export { POSTER_MAX_DIMENSION, renderMediaUrl, type RenderMediaKind } from './router/media-url';

// Captions.
export {
  CAPTION_FONT_FILES,
  FALLBACK_FONTS,
  FONT_CATEGORY,
  createCompositionFonts,
  fontCoverage,
  fontCovers,
  fontFacesFor,
  fontMetrics,
  fontStack,
  resolveFontDir,
  type FontCategory,
  type FontDirSources,
  type FontFileEntry,
  type FontKey,
} from './captions/fonts';
export { createTextMeasurer, type DetailedTextMeasurer } from './captions/measure';
export { buildCaptionCues, captionWordsFromPlan, minCueFrames, type BuildCuesOptions } from './captions/cues';
export { clampAnchorY, layoutCue, type CueLayoutDetail } from './captions/layout';
export {
  CLASSIC_STYLE,
  captionLookFromOverlay,
  clampStyleToPreset,
  matchCaptionStyle,
  type CaptionLook,
} from './captions/style';
export { toSrt, toVtt } from './captions/subtitles';
export { captionGlyphIssues, type GlyphIssue } from './captions/glyphs';
export {
  createCaptionCommands,
  type CaptionCommandDeps,
  type CaptionTrackSummary,
} from './captions/commands';

// Sound and music.
export {
  MIX_SAMPLE_RATE,
  atempoChain,
  mixFilterGraph,
  planAudioMix,
  toSamples,
  type AudioMixPlan,
  type AudioSourceMap,
  type MixSegment,
} from './audio/mix-plan';
export {
  mixAudio,
  muxAudio,
  renderMix,
  renormaliseAudio,
  type MixOptions,
  type MixResult,
} from './audio/mix';
export {
  AAC_HEADROOM_DB,
  createAudioFallbackReporter,
  LoudnessUnmeasured,
  measureLoudness,
  type LoudnessMeasure,
  type LoudnessTarget,
} from './audio/loudness';
export {
  musicPreflight,
  PLATFORM_SOUND_STEP_COUNTS,
  platformSoundSteps,
  type MusicFiles,
  type MusicPreflightDeps,
} from './music/paths';
export { keptReferenceAudio, type KeptReferenceDeps } from './music/reference-audio';

// The QA gate.
export { runQa, type QaContext, type RunQaInput } from './qa/run-qa';
export { preflightPassed, runPreflight, type PreflightInput } from './qa/run-preflight';
export {
  nextRound,
  QaRoundsExhausted,
  runQaWithFixes,
  type AutoAction,
  type FixLoopInput,
} from './qa/fix-loop';
export {
  finalizeRender,
  markNeedsAttention,
  overrideQa,
  type FinalizeDeps,
  type FinalizeFs,
  type FinalizeInput,
} from './qa/finalize';
export { planCaptionFix, planQaFixes, type CaptionStylePatch, type PlannedQaFixes } from './qa/fixes';
export { cardChecks, DELIVERABLE_VERDICTS, mergeRerun, summarize, verdictOf } from './qa/verdict';
export { checkMeta, QA_CHECKS, type QaCheckMeta } from './qa/result';
export { QA_THRESHOLDS, QA_THRESHOLDS_VERSION } from './qa/thresholds.v1';
export type { GlyphChecker, QaTarget } from './qa/checks/captions';
export type { FontCheckItem, MediaCheckItem, PreflightMediaInput } from './qa/checks/preflight';
export {
  createRenderSkillModule,
  REVIEWER_SKILL_ID,
  reviewerInputSchema,
  reviewerSkill,
  type RenderSkillDeps,
} from './skills/reviewer';
export {
  checkDraftReview,
  draftReviewOutputSchema,
  postExportReviewSchema,
  verifyReviewerHandoff,
  type DraftReview,
  type ReviewerHandoff,
} from './skills/review-checks';
// HFW1: the Designer, its workspace tools and the composition commands they dispatch.
export * from './designer-exports';

// Commands, jobs, tools, the interim store and settings.
export {
  createRenderCommands,
  type ExportReceipt,
  type OverrideResult,
  type RenderCommandDeps,
} from './commands/render-commands';
export { createMusicCommands } from './commands/music-commands';
export { exportRequestKey, PRESET_NAMES, renderName } from './commands/request';
export {
  createRenderJobs,
  RENDER_EXPORT_RETRY,
  RENDER_EXPORT_TIMEOUT_MS,
  RENDER_JOB_STAGES,
  renderExportJob,
  renderExportJobKey,
  renderPurgeJob,
  renderPurgeJobKey,
  type RenderJobDeps,
} from './jobs/render-jobs';
export { renderToolModule, type RenderToolDeps } from './tools/render-tools';
export { draftOutputSchema, renderDraftTool } from './tools/draft-tool';
// AGT2-MATCH: the Maker's finish, and QA's slot match (match-exports.ts).
export * from './match-exports';
export {
  captureFrameToolInputSchema,
  timelineToolModule,
  type CaptureFrameToolDeps,
} from './tools/capture-frame-tool';
export { captionToolModule } from './tools/caption-tools';
export { musicChoiceToolSchema, musicToolModule } from './tools/music-tools';
export { exportApprovalCard, renderProgressCard } from './tools/render-cards';
export {
  CONFORM_CACHE_MAX_BYTES,
  DELETED_RENDER_KEEP_MS,
  planRenderPurge,
  purgeDeletedRenders,
  purgeRenderCache,
  type PurgeOptions,
  type PurgePlan,
} from './store/purge';
export {
  renderDestination,
  renderWorkDir,
  renderWorkFile,
  renderWorkSidecar,
  type SidecarFormat,
} from './store/paths';
export { FINAL_RENDER_STATUSES, RUNNING_RENDER_STATUSES, toRenderSnapshot } from './store/snapshot';
export {
  DEFAULT_EXPORT_SETTINGS,
  exportSettingFor,
  exportSettingsSchema,
  readExportSettings,
  type ExportSettings,
} from './settings';
export {
  timelineAccessOverStore,
  timelinesUnavailable,
  type TimelineRevisions,
} from './store/timeline-access';

// Phase 3 (SPEC P3.1): each feature's public surface from its own folder.
export * from './errors-phase3';
export {
  exportJobOf,
  type ExportJobRef,
  type GradeLutSource,
  type ProvenanceLookup,
  type SubjectTrackSource,
} from './ports-phase3';
export * from './reframe';
export * from './credentials';
// HFW1: a graphic is a composition the Designer made: its commands, its tools and how it is timed.
export * from './compositions';
export {
  APPLY_CUBE_METHOD,
  applyGrade,
  bt709ToRgbFilter,
  ciede2000,
  createHelperCubeApplier,
  CUBE_PROBLEMS,
  cubeFromFunction,
  decodeRgbFrame,
  filesDeltaE,
  frameDeltaE,
  GRADE_RECIPE,
  gradedKey,
  gradeSegment,
  HELPER_CUBE_SIZES,
  identityCube,
  parseCube,
  readCube,
  RGB_TO_BT709_FILTER,
  writeCube,
  type CubeApplier,
  type CubeApplyOptions,
  type CubeLut,
  type GradeSegmentInput,
} from './grade';
export { OVERLAY_PRESET_IDS, hasPreset, isPortraitPreset } from './presets/presets.v1';
export { createBatchCommands, type BatchReceipt } from './batch/batch-commands';
export { batchProgress, foldBatch } from './batch/batch-progress';
export { renderBatchTool } from './batch/batch-tool';
export { createStyleSource, type StyleSource, type StyleSourceDeps } from './style/resolve-style';
export { styleExport, type StyledExport } from './style/export-style';
export { brandLayout, WATERMARK_MAX_OPACITY } from './style/brand-layout';
export { STILL_EASE, STILL_MOTION, stillMotionTracks } from './stills/still-motion';
export { mixExport, renderExportMix, type ExportMixInput, type ExportMixResult } from './audio/export-mix';
export { audioRoles } from './audio/roles';
export { SPEECH_JOIN_MS, speechJoins } from './audio/speech-joins';
export { gainExpression } from './audio/ducking-apply';
export { musicSources, type GeneratedMusic } from './music/paths';
export { applyTranslationCommand, MIN_WORD_MS, translateTrack } from './captions/translation';
export { storedRequest } from './store/stored-request';
export { exportCredentials, type ExportCredentialsDeps } from './router/export-credentials';
export { QA_MODULES, type QaCheckModule, type QaFacts, type SoundListeningFact } from './qa/modules';
export { brandAssetsCheck } from './qa/checks/brand';
export { contentCredentialsCheck, CREDENTIAL_PROBLEMS, credentialProblems } from './qa/checks/credentials';
export { GRAPHICS_THRESHOLDS } from './qa/checks/graphics';
export { captionCoversFaceCheck, cropJitterCheck, subjectInFrameCheck } from './qa/checks/reframe';
export { voiceOverMusicCheck } from './qa/checks/voice-over-music';
export { soundCleanCheck, type SoundCleanInput } from './qa/checks/sound-clean';
export { soundCritiqueCheck, type SoundCritiqueInput } from './qa/checks/sound-critique';
export { soundOnCutsCheck, type SoundOnCutsInput } from './qa/checks/sound-on-cuts';
// LRN1-STY: a render made like a set of references keeps the set's pacing.
export {
  STYLE_PACING_SLACK,
  stylePacingCheck,
  stylePacingLimits,
  stylePacingShots,
  type StylePacingFact,
  type StylePacingShot,
  type StylePacingSource,
} from './qa/checks/style-pacing';
export { createSubjectTrackSource, type SubjectSourceDeps } from './engine/subject-source';
export { createSubjectSource, spanOf, type SubjectsDeps } from './engine/subjects';
// HFW1 tpl: the reading's briefs, the template's graphics by the Designer, and the vision judge.
export * from './workspace/template';
// AGT2 eyes: video.compare, library.frameAt and library.subjects, and the pictures rule.
export * from './eyes';
export { renderEditorCapabilities } from './editor-capabilities';
export { inspectAuthoredProgram, editAuthoredProgram } from './authored/editor';
export { prepareAuthoredProgram, AUTHORED_COMPILE_LIMITS } from './authored/prepare';
