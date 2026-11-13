// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/templates: Template schema, breakdown pipeline, versioning.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/templates' and never from a path inside src/. See SPEC.md.
 */
export * from './errors';
export type * from './types';
export * from './schema/migrations';
export * from './schema/json-schema';
export * from './edits/timing';
export * from './edits/slot-edits';
export * from './edits/cut-edits';
export * from './edits/review-edits';
export { scaleBeatMap } from './edits/tempo';
export * from './review/propose-edits';
export { PROPOSALS_ASKED, PROPOSE_EDITS_PROMPT, proposeEditsText } from './review/propose-prompt';
export { readProposals, type ReadProposals } from './review/propose-answer';
export * from './store/change-key';
export * from './store/template-service';
export * from './vectors';
// Learning round 1: style profiles (LRN1-STY).
export * from './profiles';
export * from './commands/template-commands';
export * from './formats/allocate';
export * from './formats/sections';
export * from './formats/plan-format';
export * from './formats/registry';
export * from './breakdown/config';
export type * from './breakdown/ports';
export * from './breakdown/cut-merge';
export * from './breakdown/text-track';
export * from './breakdown/text-overlay';
// FIX-SIGN: composited or scene, a record per reading (DSG1's reader takes it as input).
export {
  quadTilt,
  verdictOf,
  weighText,
  type TextEvidence,
  type TextRegionJudgement,
  type TextVerdict,
  type WeighOptions,
} from './breakdown/text-scene';
export { SCENE_SIGNALS, type SceneSignal } from './breakdown/text-signals';
export { draftTextRegionSchema, type DraftTextRegion } from './breakdown/text-judge';
export {
  measureTextPixels,
  type ContextCrop,
  type PixelEvidence,
  type TextPlace,
} from './breakdown/text-motion';
// FRM1-OVL: each overlay's place relative to the reel's subject.
export * from './breakdown/overlay-relation';
export * from './breakdown/audio-profile';
// EAR1-C1: the breakdown's listening stage and its move onto the template's slots.
export * from './breakdown/listening-stage';
export * from './breakdown/listening-slots';
export * from './breakdown/listening-audio';
// EAR1-C2: the reel's effects on a video made from its template.
export * from './sound/reel-hits';
export * from './sound/reel-sfx';
export * from './breakdown/transitions';
export * from './breakdown/contact-sheet';
// BRK1 looks: the strip describer the agent root hands templates.breakdown.
export { stripDescriber, type DescribeStrip } from './breakdown/looks';
// DSG1-READ: a reel's graphics read as design (the app serves the vision call).
export {
  GRAPHIC_BRIEF_PROMPT,
  graphicReading,
  readGraphicAnswer,
  withGraphicReading,
  type GraphicModel,
  type GraphicModelAnswer,
  type GraphicModelRequest,
} from './breakdown/graphic-brief';
export { editGraphic, setGraphic } from './edits/graphic-edits';
export * from './breakdown/draft';
export * from './breakdown/build-template';
export * from './breakdown/fingerprint';
export * from './breakdown/run-breakdown';
export * from './intake/reference-link';
export * from './intake/fetcher';
export * from './intake/source-profile';
export * from './jobs/kinds';
export * from './jobs/handlers';
export * from './tools/schemas';
export * from './tools/deps';
export * from './tools/intake-tools';
export * from './tools/finalise-tools';
export * from './tools/intent-tools';
export * from './tools/keep-media';
export * from './tools/fetch-media';
export * from './intake/fetch-login';
export * from './tools/library-tools';
export * from './tools/search-schemas';
export * from './tools/style-profile-tools';
export * from './tools/instagram-tools';
export * from './tools/edit-tools';
export * from './tools/module';
export * from './skills/analyst';
export { JUDGED_DISPUTES } from './breakdown/slot-context-disputes';
export {
  INTENT_LIMITS,
  MAX_SLOT_PAGE,
  PAGE_MAX_BYTES,
  PAGE_PEAKS,
  PAGE_SPARE_TOKENS,
  pagePeak,
  slotPageFor,
  SMALLEST_WINDOW,
} from './breakdown/slot-context-pages';
export * from './hub';
export * from './styles/style-service';
export * from './styles/style-commands';
export * from './styles/node-image-reader';
export * from './styles/caption-look';
export * from './styles/template-set-style';
export * from './library/with-library-reads';
export * from './library/folder-commands';
export * from './library/metadata-commands';
export * from './library/import-commands';
export * from './library/freshness';
export * from './library/tags';
export * from './starters/starter-service';
export * from './starters/starter-commands';
export * from './energy/energy-commands';
export * from './energy/energy-curve';
export * from './instagram/instagram-client';
export * from './instagram/instagram-service';
export * from './instagram/instagram-commands';
