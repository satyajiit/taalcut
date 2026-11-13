// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/timeline: what a timeline does. The Timeline v1 types are core's;
 * this package owns the edits and their beat re-sync, the casting engine,
 * assembly, story order, OpenTimelineIO export, the timelines service, the
 * command handlers, the `timeline` tools and the Librarian and Editor skills.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/timeline' and never from a path inside src/. See SPEC.md.
 */

// Model, edits and re-sync (P2-M1).
export { migrateTimeline, checkEdited } from './model/validate';
export { slotProvenance, type SlotProvenance } from './model/provenance';
export { cutsOffAnchor, timelineStats, type OffBeatCut } from './model/checks';
export { EDIT_CONFIG, type EditConfig } from './model/config';
export { MARKER_LABELS, MARKER_TEXT } from './model/markers';
export { rampFrames } from './model/speed';
export { swapClip, applyCast, type Replacement, type SwapInput, type ApplyCastOptions } from './edits/swap';
export { trimClip, type TrimInput } from './edits/trim';
export { moveClip, type MoveInput } from './edits/move';
export { editText, moveText, lockClip } from './edits/text';
export { resyncBeats, setClipFit } from './edits/qa-fixes';
export { trimToDuration, type TrimToDurationInput } from './edits/trim-duration';
export { TIMELINE_PARTS, type EditOptions, type EditResult, type TimelinePart } from './edits/types';
export { beatsUnderTimeline, resync, resyncToBeatMap, type ResyncOptions } from './resync/resync';

// Commands, service and router port (P2-M1, M7).
export { createTimelineCommands, type TimelineCommands } from './commands/commands';
export type { TimelineCommandDeps, TimelineResult } from './commands/context';
export { createTimelineService, type TimelineService, type TimelineServiceDeps } from './service/service';
export { storeTemplateReader, memoryTemplateReader, type TemplateReader } from './service/templates';

// Casting (P2-M2, M12) and assembly (P2-M4).
export {
  createCastingEngine,
  type AlternatesRequest,
  type CastingEngine,
  type CastingEngineDeps,
  type CastRequest,
  type CastResult,
} from './casting/engine';
export type { CastVariant } from './casting/result';
export {
  createMemoryShotCatalog,
  matchesFilter,
  profileKey,
  type CatalogHit,
  type ShotCatalog,
} from './casting/catalog';
export { vectorShotCatalog } from './casting/vector-catalog';
export { CASTING_CONFIG, castingConfigSchema, type CastingConfig } from './casting/config';
export { fitConfidence } from './casting/alternates';
// FIX-GAPS: a pick under casting's confidence line is a gap too, with its next-best candidates by fit.
export { isWeakPick, weakPickOf, type WeakPick, type WeakShot } from './gaps/weak-picks';
export * from './fit';
// Learned casting preferences (LRN1-PREF).
export * from './casting/learned';
export { assemble, reframeFor, type AssembleIds, type AssembleInput } from './assembly/assemble';
// DSG1-AUT: which kit component a design is drawn with (the design loop designs those).
export { designedGraphic, isGraphicOverlay } from './assembly/designed';
// FRM1-SUB: subject tracks for every clip before the first draft, and the clips' aspects for reframing.
export {
  castRanges,
  ensureSubjects,
  SUBJECT_BUDGET_MS,
  timelineRanges,
  type EnsureReport,
  type FrameSizes,
  type SubjectDeps,
} from './assembly/subjects';
// BRK1-MAKE: the made video follows the clips' orientation, and its overlays are fitted to it.
export { followedOrientation, MADE_CANVAS_SIZES, madeCanvas } from './casting/follow-canvas';
export { fitBox, fitTextTracks, MADE_SAFE_AREAS } from './assembly/fit-layout';

// Pro export (P2-M1, P3-V5): OpenTimelineIO and FCPXML writers behind one registry.
export {
  toOtio,
  serializeOtio,
  type OtioMediaSource,
  type ResolveMedia,
} from './interchange/otio/otio-writer';
export { otioTimelineSchema, type OtioTimeline } from './interchange/otio/schema';
export { readOtio, otioCutList } from './interchange/otio/read-back';
export { fcpxmlCutList } from './interchange/fcpxml/read-back';
export { FCPXML_VERSION } from './interchange/fcpxml/fcpxml-exporter';
export { OTIO_VERSION } from './interchange/otio/otio-exporter';
export {
  defineExporter,
  type InterchangeContext,
  type InterchangeDocument,
  type TimelineExporter,
} from './interchange/exporter';
export { createExporterRegistry, type ExporterRegistry } from './interchange/registry';
export { EXPORTERS, defaultExporterRegistry } from './interchange/catalog';
export { cutList, cutDifferences, type CutEntry, type CutList } from './interchange/cut-list';
export { exportInterchange, type InterchangeDeps } from './interchange/export-interchange';

// Talking-head cleanup (P3-V9), energy curve (P3-V12), looks (P3-V16) and variants (P3-V3).
export type { CleanupReadDeps } from './cleanup/cleanup-reads';
export { planCleanup } from './cleanup/plan-cleanup';
export type { EnergyCurveApplier, EnergyDeps } from './energy/energy-deps';
export { captionPresetOf, withCaptionStyle } from './styles/caption-look';
export type { VariantMusicDeps } from './variants/variant-deps';
export { planVariants, type PlanVariantsInput, type VariantPlan } from './variants/plan-variants';
export type { VariantAxis, VariantContext, VariantPlanRequest } from './variants/axis';

// Agent tools and skills.
export { timelineToolModule, type TimelineToolDeps } from './tools/module';
// EDT1-OPS: the sound's edits, an `audio` module the agent process joins to audio's.
export { audioEditToolModule } from './tools/editor-tools';
export { clipNumberingOf, type ClipNumbering } from './tools/clip-refs';
export { RERANK_SLOTS, type ShotDescriptions } from './tools/rerank-material';
export {
  slotFactsOf,
  slotFactsSchema,
  slotPlacesOf,
  SLOT_INTENT_CHARS,
  type SlotFacts,
  type SlotPlace,
} from './tools/slot-facts';
export {
  GRAPHICS_WAIT_MAX_MS,
  graphicsWaitSchema,
  type GraphicsReady,
  type GraphicsWait,
} from './tools/graphics-wait';
export { LIBRARIAN_EXTRA_TOOLS, timelineSkillModule, type TimelineSkillDeps } from './skills/skills';
export { librarianSettler } from './skills/librarian-settle';
export { AI_CONTEXT_TOOLS, WORKSPACE_COMPOSITION_TOOLS, WORKSPACE_SHELL_TOOLS } from './skills/editor-skill';
export {
  MAKER_SEAM_TOOLS,
  MAKER_SKILL_ID,
  MAKER_TOOL_NAMES,
  makerInputSchema,
  makerOutputSchema,
  type MakerSkillDeps,
} from './skills/maker-skill';
// AGT2: the Maker's own instructions, which eval:make runs the model on.
export { MAKER_PROMPT } from './skills/maker-prompt';
// EDT1-GFX: the Editor's graphics block (the graphics:create eval prompts with it).
export { EDITOR_GRAPHICS_PROMPT, EDITOR_GRAPHICS_TOOLS } from './skills/editor-graphics';

export * from './errors';
// FRM1-OVL: the placement solver; render's layout and QA read heads as it does.
export {
  placeOverlays,
  type PlaceInput,
  type PlacementReport,
  type PlaceResult,
} from './assembly/placement/place-timeline';
export { runPlacement, type PlacementDeps, type PlacementRun } from './assembly/placement/run-placement';
export { checkSceneOf, type CheckScene } from './assembly/placement/check-scene';
export { headsOf } from './assembly/placement/subjects';
export { headMarginOf } from './assembly/placement/costs';
export { SOLVER_CONFIG, solvePlacements } from './assembly/placement/solve';

// AGT2-MATCH: each draft shot against its slot (render QA's slot match), and video.done's verdict.
export { needVerdicts, type NeedVerdict } from './match/shot-needs';
export { slotShots, type SlotShot, type SlotShotsDeps } from './match/slot-shots';
export { showsFace } from './casting/subject-motion';
export {
  checkVideoDone,
  type VideoDoneDraft,
  type VideoDoneInput,
  type VideoDoneOutcome,
  type VideoDoneReason,
} from './match/video-done';

export { timelineEditorCapabilities } from './editor-capabilities';
export {
  createAuthoredTimeline,
  replaceAuthoredProgram,
  type CreateAuthoredTimelineInput,
} from './assembly/authored';
export { createPrepareNarration } from './tools/prepare-narration';

export { assembleShort, type AssembleShortInput } from './assembly/short';
export { speechItems } from './model/speech';
export { transcriptOccurrences } from './edits/transcript-occurrences';
export { setVisualLayout } from './edits/visual-layout';

export {
  layoutCropAt,
  layoutTransform,
  layoutBoxOnCanvas,
  type LayoutSize,
  type VisualRegion,
} from './model/visual-layout';
export { createShortLayout, type ShortLayoutInput } from './assembly/short-layout';
