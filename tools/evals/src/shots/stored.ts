// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Predictions from an indexed library (IX2-C1): the shots `vision.shots` stored for each asset, read from a
 * library database (the bench keeps each run's as `index-library.sqlite`). Every shot after the first starts
 * on a boundary; its start is moved onto the clip's grid. A transition span comes from the stage's output when
 * the detector wrote one (`cuts[].span`), matched by frame, and so does the detector that decided the asset
 * (`detector`, IX2-S2). Read-only: the database is opened as such.
 */
import { DatabaseSync } from 'node:sqlite';
import { parseJsonWith } from '@taalcut/core';
import { z } from 'zod';
import type { ClipPrediction, PredictedBoundary, ShotPredictions } from './schema';

const shotRowSchema = z.object({
  file: z.string(),
  start: z.int().nonnegative(),
  num: z.int().positive(),
  den: z.int().positive(),
});

const outputSchema = z.object({
  detector: z.enum(['model', 'scdet']).optional(),
  cuts: z.array(
    z.object({
      frame: z.int().nonnegative(),
      kind: z.enum(['cut', 'dissolve', 'fade']).optional(),
      span: z.object({ from: z.int().nonnegative(), to: z.int().nonnegative() }).optional(),
    }),
  ),
});

const outputRowSchema = z.object({ file: z.string(), output: z.string().nullable() });

type Transition = Pick<PredictedBoundary, 'kind' | 'span'>;

/** What the stage's output adds to the shots table: the transitions by frame, and the detector that decided. */
interface StageOutput {
  readonly transitions: Map<number, Transition>;
  readonly detector?: ClipPrediction['detector'];
}

function stageOutput(output: string | null): StageOutput {
  // An output that isn't JSON (or isn't the detector's) has no spans to give; the shots table still has the boundaries.
  const parsed = output === null ? null : parseJsonWith(outputSchema, output);
  const transitions = new Map<number, Transition>();
  if (!parsed) return { transitions };
  for (const cut of parsed.cuts)
    transitions.set(cut.frame, {
      ...(cut.kind ? { kind: cut.kind } : {}),
      ...(cut.span ? { span: cut.span } : {}),
    });
  return { transitions, ...(parsed.detector ? { detector: parsed.detector } : {}) };
}

/** Each asset's boundaries, by its original file name, on a grid of `fps(file)` frames a second. */
export function storedPredictions(
  libraryPath: string,
  fps: (file: string) => number | undefined,
): ShotPredictions {
  const db = new DatabaseSync(libraryPath, { readOnly: true });
  try {
    const shots = db
      .prepare(
        `SELECT a.original_filename AS file, s.start_value AS start, s.start_rate_num AS num, s.start_rate_den AS den
           FROM shots s JOIN assets a ON a.id = s.asset_id ORDER BY a.original_filename, s.index_in_asset`,
      )
      .all()
      .map((row) => shotRowSchema.parse(row));
    const outputs = db
      .prepare(
        `SELECT a.original_filename AS file, st.output AS output
           FROM asset_index_stages st JOIN assets a ON a.id = st.asset_id WHERE st.stage = 'vision.shots'`,
      )
      .all()
      .map((row) => outputRowSchema.parse(row));
    const stages = new Map(outputs.map((row) => [row.file, stageOutput(row.output)]));
    const clips = new Map<string, PredictedBoundary[]>();
    for (const shot of shots) {
      const rate = fps(shot.file);
      if (rate === undefined) continue;
      const frame = Math.round((shot.start * rate * shot.den) / shot.num);
      const list = clips.get(shot.file) ?? [];
      clips.set(shot.file, list);
      if (frame > 0) list.push({ frame, ...stages.get(shot.file)?.transitions.get(frame) });
    }
    const predictions: ClipPrediction[] = [...clips].map(([file, boundaries]) => {
      const detector = stages.get(file)?.detector;
      return { file, ...(detector ? { detector } : {}), boundaries };
    });
    return { detector: `stored:${libraryPath}`, clips: predictions };
  } finally {
    db.close();
  }
}
