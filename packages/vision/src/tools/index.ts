// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent tools: describe a frame, the breakdown's cuts, text and contact sheet, and the cut check. Re-exported
 * whole by the package's entry point (src/index.ts).
 */
export {
  createDescribeFrameTool,
  DESCRIBE_FRAME_TIMEOUT_MS,
  visionToolModule,
  type VisionToolOptions,
} from './describe-frame-tool';
export {
  breakdownTools,
  CONTACT_SHEET_TIMEOUT_MS,
  createContactSheetTool,
  createDetectCutsTool,
  createReadTextTool,
  DETECT_CUTS_TIMEOUT_MS,
  READ_TEXT_TIMEOUT_MS,
  summarizeCuts,
} from './breakdown-tools';
export {
  CONFIRM_CUTS_TIMEOUT_MS,
  confirmCutsInputSchema,
  confirmCutsOutputSchema,
  createConfirmCutsTool,
  estimateConfirmCost,
  type ConfirmCutsInput,
  type ConfirmCutsOutput,
} from './confirm-cuts-tool';
export {
  checkFrameQualityInputSchema,
  createCheckFrameQualityTool,
  createInspectCaptionZonesTool,
  inspectCaptionZonesInputSchema,
  VISUAL_QA_TIMEOUT_MS,
  visualQaTools,
  type CheckFrameQualityInput,
  type InspectCaptionZonesInput,
  type VisualQaToolDeps,
} from './visual-qa-tools';
