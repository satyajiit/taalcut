// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  defineTool,
  coverExportPayloadSchema,
  coverExportResultSchema,
  NO_TOOL_RETRY,
  ok,
} from '@taalcut/core';

export function coverExportTool() {
  return defineTool({
    name: 'render.exportCover',
    command: 'render.exportCover',
    // 1.1.0 (CVR2): a cover is saved by workspace.placeCover (a designed composition) before it is exported.
    version: '1.1.0',
    description:
      'Exports the video’s saved cover as a full-resolution JPEG in Taalcut’s exports folder: the same picture the cover panel shows, drawn from original media. Save the cover first with workspace.placeCover (a designed composition over real frames); then look at the JPEG before saying it is done.',
    summary: 'Exports the saved cover at full resolution.',
    tags: ['cover', 'thumbnail', 'export'],
    input: coverExportPayloadSchema,
    output: coverExportResultSchema,
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: ['library', 'project', 'app-data'], write: ['app-data'] },
      network: 'none',
    },
    idempotencyKey: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    run: async (input, context) => {
      const done = await context.dispatch(input);
      return done.ok ? ok(coverExportResultSchema.parse(done.value)) : done;
    },
  });
}
