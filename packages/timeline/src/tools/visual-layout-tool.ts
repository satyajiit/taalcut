// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { simpleEditorResultSchema, TIMELINE_COMMANDS } from '@taalcut/core';
import { editCommandTool } from './edit-command-tool';
import { visualLayoutToolInput } from './visual-layout-schema';

export function visualLayoutTool() {
  return editCommandTool({
    command: TIMELINE_COMMANDS.setVisualLayout,
    input: visualLayoutToolInput,
    output: simpleEditorResultSchema,
    description:
      'Sets one or two source-linked video regions on a scene. Each viewport uses the same recording and source time. Crop keyframes use absolute source time. null restores the ordinary framing. Keeps the speech and every cut unchanged.',
    summary: 'Frames a scene as one subject, both people, or content and presenter.',
    tags: ['reframe', 'framing', 'split-screen', 'layout'],
  });
}
