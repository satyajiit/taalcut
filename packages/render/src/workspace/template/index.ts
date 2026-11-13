// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl's public part of render: the reading's briefs, the template's graphics by the Designer, the judge, and
 * the make's frame checks.
 */
export {
  compositionBriefs,
  DESIGN_CANVAS,
  overlayBrief,
  type CompositionBrief,
  type OverlayBrief,
} from './brief';
export { briefMarkdown } from './brief-text';
export type {
  DesignedComposition,
  DesignFeedback,
  DesignJob,
  DesignerAnswer,
  DesignOverlay,
  DesignPicture,
  ReelFrame,
} from './designer';
export {
  designTemplateCompositions,
  TEMPLATE_DESIGN_ROUNDS,
  type DrawOver,
  type TemplateCompositionDeps,
  type TemplateDesignOutcome,
  type TemplateDesignRound,
} from './design-template';
export { visionJudge, type JudgeModel, type JudgeReel, type ReelVerdict } from './judge';
export { reelFrames, reelMomentsOf } from './reel-frames';
export {
  checkFills,
  FILL_CHECK_ROUNDS,
  fillMoments,
  type FillCheckDeps,
  type FillCheckResult,
  type FillFinding,
  type FillRedesign,
} from '../fill/check-fills';
