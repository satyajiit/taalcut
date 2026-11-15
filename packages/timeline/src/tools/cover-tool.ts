// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timeline.setCover` as the AI has it (CVR2): the cover's picture set to a frame of the video or a library image
 * as it is, with nothing designed on it, for a person who asks for exactly that. A designed cover is a
 * HyperFrames composition saved with `workspace.placeCover` (render), so this tool takes no `design`, no preset
 * words and no composition: a call that sends one is refused by its schema. A hand-made cover at the aspect keeps
 * its own words and look under the new picture; a designed one is not re-pointed here. The command itself still
 * takes a whole cover (the cover panel's edits, `workspace.placeCover`, covers saved before CVR2).
 */
import {
  ConflictError,
  COVER_MEDIUMS,
  coverTargetSchema,
  err,
  ok,
  simpleEditorResultSchema,
  THUMBNAIL_ASPECTS,
  ulidSchema,
  ValidationError,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineService } from '../service/service';
import { editCommandTool } from './edit-command-tool';

const input = coverTargetSchema.extend({
  cover: z.strictObject({
    aspect: z.enum(THUMBNAIL_ASPECTS),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('frame'), frame: z.int().nonnegative() }),
      z.object({ kind: z.literal('asset'), assetId: ulidSchema('Asset') }),
    ]),
    medium: z
      .enum(COVER_MEDIUMS)
      .describe('What the picture is made of: footage unless the person asked for other art'),
  }),
});

export function coverTool(service: TimelineService) {
  return editCommandTool({
    command: 'timeline.setCover',
    // 2.0.0 (CVR2): the picture only, with its medium; no design, preset words or composition.
    version: '2.0.0',
    description:
      'Sets the cover’s picture to one frame of the video or one library image as it is, with nothing designed ' +
      'on it: only when the person asks for exactly that frame or image as the cover. A cover with lettering or ' +
      'a layout is a composition saved with workspace.placeCover, never this. medium says what the picture is ' +
      'made of. One undo restores the cover before. Use render.exportCover to save the full-resolution JPEG.',
    summary: 'Sets the video cover to a frame or image as it is.',
    tags: ['cover', 'thumbnail', 'publish', 'frame'],
    input,
    output: simpleEditorResultSchema,
    payload: async (call) => {
      const current = await service.read(call.timelineId);
      if (!current.ok) return current;
      const held = (current.value.covers ?? []).find((cover) => cover.aspect === call.cover.aspect);
      if (held?.composition)
        return err(
          ValidationError(
            { field: 'cover' },
            {
              detail:
                'This cover is a designed composition: to change its picture, place it again with ' +
                'workspace.placeCover and the new pictures.',
            },
          ),
        );
      return ok({ ...call, cover: { ...held, ...call.cover } });
    },
    verify: async (result) => {
      const receipt = simpleEditorResultSchema.parse(result);
      const current = await service.read(receipt.timelineId);
      return !current.ok
        ? current
        : current.value.revision === receipt.revision
          ? ok(undefined)
          : err(ConflictError({ entity: 'timeline', id: receipt.timelineId }));
    },
  });
}
