// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Applying one look to many videos (P3-V10, P3-V16): `batch.applyStyle` sets a Style or a caption preset on up
 * to 50 timelines in any projects, all or nothing, as one app-wide undo step (`project: () => null`). Its inverse,
 * `batch.restoreStyles`, puts back only timelines nobody changed since. Handlers: @taalcut/timeline.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type TimelineId } from '../basics/ids';
import { captionTrackSchema } from '../render/captions';
import { captionPresetIdSchema } from '../render/caption-presets';

export const BATCH_COMMANDS = {
  /** write, app-wide; all or nothing. */
  applyStyle: 'batch.applyStyle',
  /** Internal: applyStyle's inverse; restores only timelines unchanged since. */
  restoreStyles: 'batch.restoreStyles',
} as const;

const batchItem = z.object({
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  revision: z.int().positive().optional(),
});

export const BATCH_SKIP_REASONS = ['noCaptions', 'changedSince'] as const;

/** What a batch applies: a Style, or a caption preset onto the existing captions. */
export const batchApplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('style'), styleId: idSchema<'Style'>() }),
  z.object({ kind: z.literal('captionPreset'), presetId: captionPresetIdSchema }),
]);
export type BatchApply = z.output<typeof batchApplySchema>;

export const batchCommandPayloads = {
  [BATCH_COMMANDS.applyStyle]: z.object({
    items: z.array(batchItem).min(1).max(50),
    apply: batchApplySchema,
  }),
  [BATCH_COMMANDS.restoreStyles]: z.object({
    items: z
      .array(
        batchItem.extend({
          styleId: idSchema<'Style'>().nullable(),
          captions: captionTrackSchema.nullable(),
          /** The revision the batch left; a timeline at another revision is skipped and listed. */
          revision: z.int().positive(),
        }),
      )
      .min(1)
      .max(50),
  }),
};

/** applyStyle's and restoreStyles' result. */
export interface BatchStyleResult {
  readonly receipts?: readonly {
    readonly timelineId: TimelineId;
    readonly revision: number;
    readonly affectedItemIds: readonly string[];
  }[];
  readonly applied: readonly TimelineId[];
  readonly skipped: readonly {
    readonly timelineId: TimelineId;
    readonly reason: (typeof BATCH_SKIP_REASONS)[number];
  }[];
}

/**
 * BatchStyleResult as it crosses IPC: a dispatch receipt's `result`, or an undo's (`commands.undo` of
 * `batch.applyStyle` answers `batch.restoreStyles`' result, whose `skipped` the toast lists).
 */
export const batchStyleResultSchema: z.ZodType<BatchStyleResult> = z.object({
  receipts: z
    .array(
      z.object({
        timelineId: idSchema<'Timeline'>(),
        revision: z.int().positive(),
        affectedItemIds: z.array(z.string()),
      }),
    )
    .optional(),
  applied: z.array(idSchema<'Timeline'>()).max(50),
  skipped: z
    .array(z.object({ timelineId: idSchema<'Timeline'>(), reason: z.enum(BATCH_SKIP_REASONS) }))
    .max(50),
});
