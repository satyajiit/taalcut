// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A domain module the agent has never heard of, shaped like a real domain
 * package: it imports only @taalcut/core and zod, and exports a ToolModule
 * for the composition root's list. discovery.test.ts shows the agent picks it
 * up with no change to packages/agent.
 */
import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, type ToolModule } from '@taalcut/core';
import { z } from 'zod';

export function captionsModule(): ToolModule {
  return defineToolModule({
    id: 'captions',
    tools: [
      defineTool({
        name: 'captions.suggest',
        version: '1.0.0',
        description: 'Suggests short on-screen captions for a clip from what is said in it.',
        tags: ['captions', 'text'],
        input: z.object({ clipId: z.string() }),
        output: z.object({ captions: z.array(z.string()) }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async (input) => ok({ captions: [`Sunrise over the bay (${input.clipId})`] }),
      }),
    ],
  });
}
