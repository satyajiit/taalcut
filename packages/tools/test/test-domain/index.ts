// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for a domain package (packages/media, packages/vision, ...).
 * Like a real one it imports only @taalcut/core and zod, never
 * @taalcut/tools or @taalcut/agent, and it exports a factory that takes its
 * services and returns a ToolModule. The composition root passes that module
 * to createToolRegistry(); nothing in packages/agent knows it exists.
 */
import {
  defineError,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  type AsyncResult,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';

export const ClipMissing = defineError<{ id: string }>('testdomain.clip_missing');
export const CaptionerBusy = defineError('testdomain.captioner_busy', { retryable: true });

export interface Clip {
  readonly id: string;
  readonly title: string;
  readonly seconds: number;
}

/** The services this domain's tools need, injected by the composition root. */
export interface TestDomainServices {
  readonly clips: { list(): readonly Clip[]; get(id: string): Clip | undefined };
  readonly captioner: (
    frame: string,
    signal: AbortSignal,
  ) => AsyncResult<{ text: string; inputTokens: number }>;
}

const clipSchema = z.object({ id: z.string(), title: z.string(), seconds: z.number() });

export function createTestDomainTools(services: TestDomainServices): ToolModule {
  const countWords = defineTool({
    name: 'testdomain.countWords',
    version: '1.0.0',
    description: 'Counts the words in a piece of text, such as a caption or a transcript line.',
    tags: ['text', 'statistics'],
    input: z.object({ text: z.string().describe('The text to count') }),
    output: z.object({ words: z.number().int() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    cache: true,
    run: async (input) => ok({ words: input.text.split(/\s+/).filter(Boolean).length }),
  });

  const listClips = defineTool({
    name: 'testdomain.listClips',
    version: '1.2.0',
    description: 'Lists every clip in the library with its title and length in seconds.',
    tags: ['library', 'browse'],
    input: z.object({}),
    output: z.object({ clips: z.array(clipSchema) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] } },
    summarize: (output) => `${output.clips.length} clips.`,
    run: async () => ok({ clips: [...services.clips.list()] }),
  });

  const renameClip = defineTool({
    name: 'testdomain.renameClip',
    version: '1.0.0',
    description: 'Renames a clip. Undoable.',
    input: z.object({ id: z.string(), title: z.string().min(1) }),
    output: z.object({ id: z.string(), title: z.string() }),
    costClass: 'local',
    sideEffect: 'write',
    command: 'testdomain.renameClip',
    timeoutMs: 2_000,
    retry: { maxAttempts: 3, initialDelayMs: 10 },
    idempotencyKey: (input) => `${input.id}:${input.title}`,
    run: async (input, ctx) => {
      if (!services.clips.get(input.id)) return err(ClipMissing({ id: input.id }));
      const dispatched = await ctx.dispatch({ id: input.id, title: input.title });
      return dispatched.ok ? ok({ id: input.id, title: input.title }) : dispatched;
    },
  });

  const deleteClip = defineTool({
    name: 'testdomain.deleteClip',
    version: '1.0.0',
    description: 'Deletes a clip from the library and moves its file to the Trash.',
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.literal(true) }),
    costClass: 'local',
    sideEffect: 'destructive',
    command: 'testdomain.deleteClip',
    timeoutMs: 2_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { write: ['library'] } },
    idempotencyKey: (input) => input.id,
    run: async (input, ctx) => {
      const dispatched = await ctx.dispatch({ id: input.id });
      return dispatched.ok ? ok({ deleted: true as const }) : dispatched;
    },
  });

  const shareClip = defineTool({
    name: 'testdomain.shareClip',
    version: '0.3.0',
    description: 'Uploads a clip to a share link that anyone with the link can watch.',
    input: z.object({ id: z.string() }),
    output: z.object({ url: z.string() }),
    costClass: 'local',
    sideEffect: 'external',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', filesystem: { read: ['library'] } },
    idempotencyKey: (input) => input.id,
    run: async (input) => ok({ url: `https://share.invalid/${input.id}` }),
  });

  const captionFrame = defineTool({
    name: 'testdomain.captionFrame',
    version: '2.0.0',
    description: 'Describes what is in a video frame in one sentence, using a cloud vision model.',
    tags: ['vision', 'describe', 'image'],
    input: z.object({ frame: z.string().describe('Artifact id or path of the frame image') }),
    output: z.object({ caption: z.string() }),
    costClass: 'cloud',
    sideEffect: 'read',
    timeoutMs: 20_000,
    retry: { maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 200 },
    permission: { network: 'internet', cloudModules: ['vision'] },
    estimateCost: () => ({ usd: 0.004, tokens: 1_500, basis: 'one 1024px image plus a short prompt' }),
    run: async (input, ctx) => {
      const described = await services.captioner(input.frame, ctx.signal);
      if (!described.ok) return described;
      ctx.reportUsage({
        usd: 0.003,
        inputTokens: described.value.inputTokens,
        outputTokens: 20,
        model: 'fake',
      });
      return ok({ caption: described.value.text });
    },
  });

  return defineToolModule({
    id: 'testdomain',
    tools: [countWords, listClips, renameClip, deleteClip, shareClip, captionFrame],
  });
}
