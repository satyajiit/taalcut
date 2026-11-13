// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Smart reframe's public surface (SPEC P3.2); src/index.ts re-exports it. */
export { REFRAME_CONFIG, type ReframeConfig } from './config';
export {
  FRAMING_REASONS,
  NO_FRAMING,
  type CropKey,
  type FramingPlan,
  type FramingReason,
  type SourcePoint,
  type SourceRect,
  type VisualFraming,
} from './framing-types';
export { AUTO_REFRAME, planVisualFraming, type FramingInput } from './framing';
export { boxAt, coverWindow, cropAt, sameAspect } from './crop-window';
export {
  blurPadGeometry,
  framingGeometry,
  framingStyle,
  probedCrop,
  type FramingGeometry,
  type FramingStyleInput,
} from './keyframes';
export { clearTop, dodgeCaptions, rectsOverlap, type DodgeCue } from './caption-dodge';
export { measureJitter, type JitterInput, type JitterReport } from './jitter';
export {
  boxInsideShare,
  framingCoverage,
  onCanvas,
  subjectCoverage,
  type CoverageResult,
} from './subject-coverage';
export {
  createSubjectTracker,
  ONNX_TRACK_RECIPE,
  TRACK_RECIPE,
  type HelperRequester,
  type SubjectTracker,
  type TrackShotInput,
  type TrackShotResult,
} from './subject-tracker';
export {
  createSubjectTrackStore,
  subjectTrackKey,
  SUBJECT_TRACK_FILE_VERSION,
  type DerivedJsonFiles,
  type SubjectTrackStore,
  type SubjectTrackStoreDeps,
} from './subject-store';
export {
  TRACK_SUBJECTS_RETRY,
  TRACK_SUBJECTS_TIMEOUT_MS,
  trackSubjectsJob,
  trackSubjectsRegistration,
  type TrackSubjectsDeps,
} from './track-job';
