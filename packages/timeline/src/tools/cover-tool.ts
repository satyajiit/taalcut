// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ConflictError, err, ok, setCoverPayloadSchema, simpleEditorResultSchema } from '@taalcut/core';
import type { TimelineService } from '../service/service';
import { editCommandTool } from './edit-command-tool';

export function coverTool(service: TimelineService) {
  return editCommandTool({
    command: 'timeline.setCover',
    description:
      'Saves a cover using a timeline frame, an image asset or a solid background. Optional cover.design composes up to 16 editable text, shape and bounded vector-path layers with an explicit palette, normalized layout and image crop; it replaces preset overlays. One undo restores the prior choices. Use render.exportCover to save the full-resolution JPEG.',
    summary: 'Saves a video cover shared with the publishing studio.',
    tags: ['cover', 'thumbnail', 'publish'],
    input: setCoverPayloadSchema,
    output: simpleEditorResultSchema,
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
