// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineTool,
  defineToolModule,
  editorCapabilitySchema,
  NO_TOOL_RETRY,
  ok,
  type EditorCapability,
} from '@taalcut/core';
import { z } from 'zod';

/** Read at call time: the same composed catalogue determines the Editor's eligible tools. */
export function editorCatalogueTool(capabilities: () => readonly EditorCapability[]) {
  return defineToolModule({
    id: 'editor',
    tools: [
      defineTool({
        name: 'editor.capabilities',
        version: '1.0.0',
        description:
          'Lists supported editor actions, their commands and tools, unavailable features and intentional person-only actions. Explain unavailable requests accurately; recording a microphone requires the person to press Record.',
        summary: 'Reads supported editor actions and their availability.',
        tags: ['editor', 'capabilities', 'availability', 'read'],
        input: z.object({}),
        output: z.array(editorCapabilitySchema),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: () => 'editor.capabilities',
        run: async () => ok([...capabilities()]),
      }),
    ],
  });
}
