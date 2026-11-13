// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Colour grade (P3-V17, SPEC P3.7): reading cubes, applying them GPU first, and measuring ΔE00. */
export {
  CUBE_PROBLEMS,
  cubeFromFunction,
  identityCube,
  parseCube,
  readCube,
  writeCube,
  type CubeLut,
  type CubeProblem,
  type ParseCubeOptions,
  type Rgb,
} from './cube-file';
export { sampleCube } from './cube-sample';
export {
  APPLY_CUBE_METHOD,
  createHelperCubeApplier,
  HELPER_CUBE_SIZES,
  type CubeApplier,
  type CubeApplyOptions,
  type CubeApplyOutcome,
  type CubeApplyRequest,
  type HelperRequester,
} from './cube-applier';
export {
  applyGrade,
  cpuGradeFilter,
  filterPathArg,
  GRADE_RECIPE,
  gradedKey,
  type ApplyGradeInput,
  type GradedSegment,
} from './apply-grade';
export { bt709ToRgbFilter, RGB_TO_BT709_FILTER } from './colour-filters';
export { gradeSegment, type GradedSegmentFile, type GradeSegmentInput } from './grade-segment';
export { ciede2000, frameDeltaE, labOfRgb, type DeltaEStats, type Lab } from './delta-e';
export { decodeRgb48Frame, decodeRgbFrame, filesDeltaE, type DecodeFrameOptions } from './frame-delta-e';
