// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One call for the export's `grading` stage (SPEC P3.7): read and validate the clip's baked cube (an invalid
 * one is `render.cube_invalid` before any encode), name the graded segment by the segment's key and the
 * cube's bytes, and apply it GPU first.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AsyncResult } from '@taalcut/core';
import { applyGrade, gradedKey, type ApplyGradeInput, type GradedSegment } from './apply-grade';
import { readCube } from './cube-file';

export interface GradeSegmentInput extends Omit<ApplyGradeInput, 'cube' | 'out'> {
  /** The conformed segment's content key (ConformedSegment.key). */
  readonly segmentKey: string;
  /** Where graded segments are cached (beside the conform cache). */
  readonly dir: string;
  /** Cube sizes accepted. Default core's LUT_CUBE_SIZES. */
  readonly sizes?: readonly number[];
}

export interface GradedSegmentFile extends GradedSegment {
  /** The cache key: names the file and goes into the composition hash in place of the segment's. */
  readonly key: string;
}

export async function gradeSegment(input: GradeSegmentInput): AsyncResult<GradedSegmentFile> {
  const cube = await readCube(input.cubePath, input.sizes ? { sizes: input.sizes } : {});
  if (!cube.ok) return cube;
  const key = gradedKey(input.segmentKey, cube.value.sha256);
  await mkdir(input.dir, { recursive: true });
  const { segmentKey: _segmentKey, dir: _dir, sizes: _sizes, ...rest } = input;
  const graded = await applyGrade({ ...rest, cube: cube.value.lut, out: join(input.dir, `${key}.mp4`) });
  if (!graded.ok) return graded;
  return ok({ ...graded.value, key });
}
