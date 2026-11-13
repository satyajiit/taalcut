// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tool modules shaped like domain packages (they import only @taalcut/core
 * and zod): a 'clips' domain for loop, approval and injection tests, and
 * stand-ins for the three gate-demo tools (library.addSource, media.probe,
 * vision.describeFrame).
 */
import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, type ToolModule } from '@taalcut/core';
import { z } from 'zod';

export interface FixtureOptions {
  /** What clips.readOcr finds on screen. */
  readonly ocrText?: string;
  /** Called when a barrier read starts; resolves when the test lets it finish. */
  readonly barrier?: (id: string) => Promise<void>;
  /** Called around each write so tests can check writes never overlap. */
  readonly onWrite?: (phase: 'start' | 'end', id: string) => void;
}

const idInput = z.object({ id: z.string() });

export function clipsModule(options: FixtureOptions = {}): ToolModule {
  return defineToolModule({
    id: 'clips',
    tools: [
      defineTool({
        name: 'clips.countWords',
        version: '1.0.0',
        description: 'Counts the words in a caption or any text.',
        tags: ['text'],
        input: z.object({ text: z.string() }),
        output: z.object({ words: z.number() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        cache: true,
        run: async (input) => ok({ words: input.text.split(/\s+/).filter(Boolean).length }),
      }),
      defineTool({
        name: 'clips.listClips',
        version: '1.0.0',
        description: 'Lists the clips in the library with titles and lengths.',
        input: z.object({ count: z.number().int().default(3) }),
        output: z.object({
          clips: z.array(z.object({ id: z.string(), title: z.string(), seconds: z.number() })),
        }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        summarize: (output) => `${output.clips.length} clips.`,
        run: async (input) =>
          ok({
            clips: Array.from({ length: input.count }, (_, i) => ({
              id: `c${i}`,
              title: `Beach shot number ${i}`,
              seconds: i + 1,
            })),
          }),
      }),
      defineTool({
        name: 'clips.waitAtBarrier',
        version: '1.0.0',
        description: 'Test tool: waits at a barrier shared with other reads.',
        input: idInput,
        output: z.object({ id: z.string() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 2_000,
        retry: NO_TOOL_RETRY,
        run: async (input) => {
          await options.barrier?.(input.id);
          return ok({ id: input.id });
        },
      }),
      defineTool({
        name: 'clips.renameClip',
        version: '1.0.0',
        description: 'Renames a clip. Undoable.',
        input: z.object({ id: z.string(), title: z.string() }),
        output: z.object({ renamed: z.boolean() }),
        costClass: 'local',
        sideEffect: 'write',
        command: 'clips.renameClip',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) => `${input.id}:${input.title}`,
        run: async (input, ctx) => {
          options.onWrite?.('start', input.id);
          const done = await ctx.dispatch(input);
          options.onWrite?.('end', input.id);
          return done.ok ? ok({ renamed: true }) : done;
        },
      }),
      defineTool({
        name: 'clips.deleteClip',
        version: '1.0.0',
        description: 'Deletes a clip from the library and moves its file to the Trash.',
        input: idInput,
        output: z.object({ deleted: z.boolean() }),
        costClass: 'local',
        sideEffect: 'destructive',
        command: 'clips.deleteClip',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) => input.id,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ deleted: true }) : done;
        },
      }),
      defineTool({
        name: 'clips.shareClip',
        version: '1.0.0',
        description: 'Uploads a clip to a public share link.',
        input: idInput,
        output: z.object({ url: z.string() }),
        costClass: 'local',
        sideEffect: 'external',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        permission: { network: 'internet' },
        idempotencyKey: (input) => input.id,
        run: async (input) => ok({ url: `https://share.invalid/${input.id}` }),
      }),
      defineTool({
        name: 'clips.renderVideo',
        version: '1.0.0',
        description: 'Renders the final video file from the timeline.',
        input: z.object({ preset: z.string() }),
        output: z.object({ file: z.string() }),
        costClass: 'local',
        sideEffect: 'write',
        command: 'clips.renderVideo',
        checkpoint: true,
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) => input.preset,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ file: `render-${input.preset}.mp4` }) : done;
        },
      }),
      defineTool({
        name: 'clips.readOcr',
        version: '1.0.0',
        description: 'Reads the on-screen text in a reference video.',
        input: z.object({ reel: z.string() }),
        output: z.object({ text: z.string().meta({ untrusted: 'ocr' }), frames: z.number() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async () => ok({ text: options.ocrText ?? 'SALE ENDS SOON', frames: 12 }),
      }),
      defineTool({
        name: 'clips.readOcrUnmarked',
        version: '1.0.0',
        description:
          'Control fixture: like readOcr, but its output schema forgets to mark the text untrusted.',
        input: z.object({ reel: z.string() }),
        output: z.object({ text: z.string(), frames: z.number() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async () => ok({ text: options.ocrText ?? 'SALE ENDS SOON', frames: 12 }),
      }),
    ],
  });
}

/**
 * Shaped like the real cloud registration of vision.describeFrame: an upload
 * of the user's media (external, cloud module 'vision'), so it needs consent.
 */
export function cloudVisionModule(
  options: { uploads?: string[]; hold?: () => Promise<void>; writeUpload?: boolean } = {},
) {
  return defineToolModule({
    id: 'vision',
    tools: [
      defineTool({
        name: 'vision.describeFrame',
        version: '1.0.0',
        description: 'Describes a video frame in one sentence with a cloud vision model.',
        input: z.object({ path: z.string(), atSeconds: z.number() }),
        output: z.object({ caption: z.string().meta({ untrusted: 'vision-model' }) }),
        costClass: 'cloud',
        sideEffect: options.writeUpload ? 'write' : 'external',
        ...(options.writeUpload ? { command: 'vision.describeFrame' } : {}),
        timeoutMs: 20_000,
        retry: NO_TOOL_RETRY,
        permission: {
          network: 'internet',
          cloudModules: ['vision'],
          filesystem: { read: ['user-selected'] },
          ...(options.writeUpload
            ? { uploads: { what: 'user-media' as const, consent: 'first-use' as const } }
            : {}),
        },
        idempotencyKey: (input) => `${input.path}@${input.atSeconds}`,
        estimateCost: () => ({ usd: 0.004, tokens: 1500 }),
        run: async (input, ctx) => {
          await options.hold?.();
          options.uploads?.push(`${input.path}@${input.atSeconds}`);
          ctx.reportUsage({ usd: 0.004, inputTokens: 1200, outputTokens: 30, model: 'fake-vision' });
          return ok({ caption: 'A drone shot over a beach at sunrise.' });
        },
      }),
    ],
  });
}

/** Stand-ins for the gate-demo tools (P1-G7 builds the real ones). */
export function gateDemoModules(): ToolModule[] {
  return [
    defineToolModule({
      id: 'library',
      tools: [
        defineTool({
          name: 'library.addSource',
          version: '1.0.0',
          description: 'Adds a folder of videos to the library as a source. Undoable.',
          input: z.object({ path: z.string() }),
          output: z.object({ sourceId: z.string(), files: z.number() }),
          costClass: 'local',
          sideEffect: 'write',
          command: 'library.addSource',
          timeoutMs: 5_000,
          retry: NO_TOOL_RETRY,
          permission: { filesystem: { read: ['user-selected'] } },
          idempotencyKey: (input) => input.path,
          run: async (input, ctx) => {
            const done = await ctx.dispatch(input);
            return done.ok ? ok({ sourceId: 'src-1', files: 3 }) : done;
          },
        }),
      ],
    }),
    defineToolModule({
      id: 'media',
      tools: [
        defineTool({
          name: 'media.probe',
          version: '1.0.0',
          description: 'Reads the duration, streams and codecs of a video file.',
          input: z.object({ path: z.string() }),
          output: z.object({ seconds: z.number(), width: z.number(), height: z.number() }),
          costClass: 'local',
          sideEffect: 'read',
          timeoutMs: 5_000,
          retry: NO_TOOL_RETRY,
          cache: true,
          run: async (_input, ctx) => {
            ctx.reportProgress(0.5);
            return ok({ seconds: 12.5, width: 1080, height: 1920 });
          },
        }),
      ],
    }),
    defineToolModule({
      id: 'vision',
      tools: [
        defineTool({
          name: 'vision.describeFrame',
          version: '1.0.0',
          description: 'Describes a video frame in one sentence with a cloud vision model.',
          input: z.object({ path: z.string(), atSeconds: z.number() }),
          output: z.object({ caption: z.string().meta({ untrusted: 'vision-model' }) }),
          costClass: 'cloud',
          sideEffect: 'read',
          timeoutMs: 20_000,
          retry: NO_TOOL_RETRY,
          permission: { network: 'internet', cloudModules: ['vision'] },
          estimateCost: () => ({ usd: 0.004, tokens: 1500 }),
          run: async (_input, ctx) => {
            ctx.reportUsage({ usd: 0.004, inputTokens: 1200, outputTokens: 30, model: 'fake-vision' });
            return ok({ caption: 'A drone shot over a beach at sunrise.' });
          },
        }),
      ],
    }),
  ];
}
