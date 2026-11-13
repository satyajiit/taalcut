// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 (ui-make): this area's public surface, re-exported by the package's index.ts. */
export { cleanupLengths, cleanupMarks, type CleanupMarks, type FrameSpanView } from './cleanup-math';
export { CleanupSummary, type CleanupSummaryProps } from './cleanup-summary';
export {
  CleanupSwitches,
  PAUSE_RANGE,
  type CleanupSwitchesProps,
  type CleanupSwitchState,
} from './cleanup-switches';
export { cleanupErrorWords, cleanupList, cleanupSentence } from './cleanup-words';
export { APPLY_CLEANUP, DEFAULT_SWITCHES } from './use-cleanup-replan';
