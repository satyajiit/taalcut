// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How far a clip's analysis has got, beyond each stage's state (LIB1-PROG): the job a stage runs as, so a window
 * can follow its `job.progress` events; the progress saved for it; when it started; and how long the stage takes on
 * this Mac, for a time left. And what holds an asset that waits, so "waiting for a model" isn't counted as
 * analysing. Every field is optional: a library from before LIB1 sends none of them.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';

const ms = z.int().nonnegative();

/** Extra fields of a stage row in `AssetDetail.stages`. */
export const stageProgressFields = {
  /** The job that runs the stage while it is queued or running: its `job.progress` events are this stage's. */
  jobId: idSchema<'Job'>().optional(),
  /** How far that job had got (0..1) when it last saved its progress, while the stage runs. */
  progress: z.number().min(0).max(1).optional(),
  /** When the stage started running (epoch ms), while it runs. */
  startedAt: ms.optional(),
  /** How long the stage takes on this Mac: the mean of its recent runs (ms). Absent until it has run here. */
  typicalMs: ms.optional(),
};

/**
 * What holds an asset that waits (`index.state` 'waiting'): an on-device model still to download, or its original
 * (a drive that isn't connected, a file only in iCloud). Nothing runs for it until that arrives.
 */
export const ASSET_HOLDS = ['model', 'original'] as const;
export const assetHoldSchema = z.enum(ASSET_HOLDS);
export type AssetHold = z.output<typeof assetHoldSchema>;
