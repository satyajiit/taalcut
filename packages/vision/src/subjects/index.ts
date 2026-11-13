// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Poses, heads, faces and people without the mac helper (FRM1-SUB): RTMO-s and YOLOX-Nano on ONNX Runtime, and a
 * shot's subject samples from them. Re-exported whole by the package's entry point (src/index.ts).
 */
export { detectFrames, detectSubjectsAlong, type SubjectsAlong, type SubjectsAlongInput } from './along';
export { chooseSubject, type ChosenSubject } from './choose';
export {
  createOnnxSubjectDetector,
  type DetectedFace,
  type DetectedPerson,
  type DetectedPose,
  type FrameSubjects,
  type OnnxSubjectDetectorOptions,
  type PoseKeypoint,
  type SubjectDetector,
} from './detector';
export type { FractionBox } from './boxes';
export {
  faceOfPose,
  headOfPerson,
  headOfPose,
  headsFrom,
  ONNX_HEAD_PROPORTIONS,
  type ScoredBox,
} from './heads';
export type { RgbFrame } from './letterbox';
export { COCO_KEYPOINTS } from './rtmo';
export {
  SUBJECT_TUNING,
  SUBJECTS_ONNX_COMPONENT,
  SUBJECTS_OPERATION,
  SUBJECTS_PERSON_FILE,
  SUBJECTS_PERSON_SIZE,
  SUBJECTS_POSE_FILE,
  type SubjectTuning,
} from './model';
