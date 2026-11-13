// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V16's agent tools: give one video a saved Style, or put a Style or a caption preset on up to 50 videos in
 * any projects at once. Each is one undo step; the batch is all or nothing and undoes from the app-wide history.
 */
import {
  BATCH_COMMANDS,
  BATCH_SKIP_REASONS,
  ConflictError,
  err,
  captionPresetIdSchema,
  defineTool,
  NO_TOOL_RETRY,
  ok,
  TIMELINE_COMMANDS,
  ulidSchema,
  type AnyTool,
} from '@taalcut/core';
import { z } from 'zod';
import { editCommandTool } from './edit-command-tool';
import { toolKey } from './hash';
import type { TimelineService } from '../service/service';

const target = {
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
};

export const setStyleToolInputSchema = z.object({ ...target, styleId: ulidSchema('Style').nullable() });

export const applyStyleToManyInputSchema = z.object({
  items: z.array(z.object(target)).min(1).max(50),
  apply: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('style'), styleId: ulidSchema('Style') }),
    z.object({ kind: z.literal('captionPreset'), presetId: captionPresetIdSchema }),
  ]),
});

export const applyStyleToManyOutputSchema = z.object({
  applied: z.array(ulidSchema('Timeline')),
  skipped: z.array(z.object({ timelineId: ulidSchema('Timeline'), reason: z.enum(BATCH_SKIP_REASONS) })),
  receipts: z
    .array(
      z.object({
        timelineId: ulidSchema('Timeline'),
        revision: z.int().positive(),
        affectedItemIds: z.array(z.string()),
      }),
    )
    .optional(),
});

export function styleTools(service?: Pick<TimelineService, 'read'>): AnyTool[] {
  const setStyle = editCommandTool({
    command: TIMELINE_COMMANDS.setStyle,
    service,
    description:
      'Gives one video a saved Style (its colours, fonts, logo, intro and outro), or clears it with null. When the Style has a caption look and the video has captions, the captions take that look. One undo step.',
    summary: 'Gives one video a saved Style, or clears it.',
    tags: ['style', 'look', 'captions'],
    input: setStyleToolInputSchema,
  });

  const applyToMany = defineTool({
    name: 'timeline.applyStyleToMany',
    version: '1.0.0',
    description:
      'Puts one look on up to 50 videos in any projects in one step: a saved Style (as timeline.setStyle on each), or a caption preset (classic, bold, boxed, karaoke, minimal) on the captions each video already has. All or nothing: if one video is missing or changes meanwhile, none change. Videos without captions are skipped for a caption preset and listed. Undo puts back every video nobody changed since.',
    summary: 'Puts a Style or a caption preset on up to 50 videos in one undoable step.',
    tags: ['style', 'look', 'captions', 'batch'],
    input: applyStyleToManyInputSchema,
    output: applyStyleToManyOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: BATCH_COMMANDS.applyStyle,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.applyStyleToMany', input),
    run: async (input, ctx) => {
      const items = [];
      for (const target of input.items) {
        if (!service || target.revision !== undefined) {
          items.push(target);
          continue;
        }
        const current = await service.read(target.timelineId);
        if (!current.ok) return current;
        items.push({ ...target, revision: current.value.revision });
      }
      const done = await ctx.dispatch({ ...input, items });
      if (!done.ok) return done;
      const result = applyStyleToManyOutputSchema.parse(done.value);
      for (const receipt of result.receipts ?? []) {
        if (!service) break;
        const current = await service.read(receipt.timelineId);
        if (!current.ok) return current;
        if (current.value.revision !== receipt.revision)
          return err(ConflictError({ entity: 'timeline', id: receipt.timelineId }));
      }
      return ok(result);
    },
  });

  return [setStyle, applyToMany as AnyTool];
}
