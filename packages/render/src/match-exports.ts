// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH's exports, kept out of index.ts for its length: `video.done` (the Maker's finish) and QA's slot match
 * (its facts and their builder for the render root's port, the checks, the heads stage's per-clip samples).
 */
export {
  VIDEO_DONE_REASONS_MAX,
  createVideoDoneLedger,
  makerDone,
  videoDoneInputSchema,
  videoDoneOutputSchema,
  videoDoneTool,
  videoToolModule,
  type VideoDoneDeps,
  type VideoDoneLedger,
} from './tools/video-done-tool';
export {
  SLOT_MATCH,
  type SlotFact,
  type SlotGraphicFact,
  type SlotMatchFact,
  type SlotMatchSource,
  type SlotMatchSourced,
} from './qa/checks/slot-match/facts';
export { slotMatchFact, type SlotMatchBuildInput } from './qa/checks/slot-match/build';
export { slotMatchChecks } from './qa/modules/slot-match';
export type { ClipHeads, HeadSample } from './engine/stages/heads';
// The reel's graphics as the Designer is held to them (eval:make's Designer stand-in draws them there).
export { DESIGN_CANVAS, graphicOverlays, overlayBrief } from './workspace/template/brief';
