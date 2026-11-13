// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A domain module shaped like vision's describeFrame registered with a cloud model in its chain: an external
 * upload through the vision chain of the ModelClient it is given (the upload and Local only tests).
 */
import { defineTool, defineToolModule, err, ok, type ToolModule } from '@taalcut/core';
import type { ModelClient } from '@taalcut/models';
import { z } from 'zod';

/** Stand-in frame bytes per file: what a contact-sheet tile would carry. */
export const frameOf = (path: string) => Buffer.from(`JPEG-FRAME:${path}`).toString('base64');

/** A domain module shaped like vision's: an external upload through the vision chain. */
export function framesModule(vision: ModelClient): ToolModule {
  return defineToolModule({
    id: 'frames',
    tools: [
      defineTool({
        name: 'frames.describe',
        version: '1.0.0',
        description: "Describes a video's frames with the cloud vision model.",
        tags: ['describe', 'frames', 'vision'],
        input: z.object({ path: z.string() }),
        output: z.object({ description: z.string() }),
        costClass: 'cloud',
        sideEffect: 'external',
        timeoutMs: 5_000,
        retry: { maxAttempts: 1, initialDelayMs: 0 },
        permission: {
          network: 'internet',
          cloudModules: ['vision'],
          uploads: { what: 'user-media', consent: 'first-use' },
        },
        idempotencyKey: (input) => input.path,
        estimateCost: () => ({ usd: 0.002, tokens: 900 }),
        run: async (input, ctx) => {
          const described = await vision.complete({
            module: 'vision',
            signal: ctx.signal,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this frame.' },
                  { type: 'image', data: frameOf(input.path), mimeType: 'image/jpeg' },
                ],
              },
            ],
          });
          return described.ok ? ok({ description: described.value.text }) : err(described.error);
        },
      }),
    ],
  });
}
