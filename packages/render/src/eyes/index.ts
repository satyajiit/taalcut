// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: the tools that show the AI its video next to the reel, and the rule for the person's pictures. */
export { FOOTAGE_KEPT, footagePicturesSchema, type FootagePictures, type FootageVerdict } from './pictures';
export { eyesToolModules, withLibraryEyes, withVideoEyes } from './module';
export type { EyesDeps } from './deps';
export {
  COMPARE_MOMENTS,
  COMPARE_ROWS_MAX,
  COMPARE_SHEETS_MAX,
  compareInputSchema,
  compareOutputSchema,
  type CompareInput,
  type CompareOutput,
} from './compare-schema';
export { JUDGE_SLOTS_MAX } from './compare-judge';
export { SLOT_JUDGE_PROMPT, slotVisionJudge, type JudgeSlot, type SlotPair } from './slot-judge';
export { SUBJECTS_SAMPLES_MAX, SUBJECTS_SPAN_MAX_SECONDS } from './library-tools';
