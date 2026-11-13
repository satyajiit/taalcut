// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in domain tool modules for the flow tests, shaped like templates,
 * timeline, render and library (they import only @taalcut/core and zod),
 * over a small in-memory "world" of stored templates, timelines and renders
 * whose versions move like the real stores'. render.export is a checkpoint
 * tool with its own approval card (exportApproval) and result card
 * (renderProgress), as the render lane declares it, and like it is bound to
 * one timeline revision: the card and the command refuse one that is gone.
 */
import {
  ConflictError,
  defineTool,
  err,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  type AnyTool,
  type ProjectId,
  type ToolModule,
  ULID_PATTERN,
} from '@taalcut/core';
import { z } from 'zod';

export interface World {
  readonly projectId: ProjectId;
  readonly templates: Map<string, number>;
  readonly timelines: Map<string, number>;
  readonly renders: Map<string, number>;
  /** Each render.review call's verdict, in order; past the end, a pass. */
  qa: boolean[];
  reviews: number;
  /** What a vision rerank really spends, per call (US$). */
  rerankUsd: number;
  readonly exported: { timelineId: string; revision: number }[];
  readonly calls: string[];
  /** Runs as render.export starts, after its approval (a user edit landing just then). */
  beforeExport?: () => Promise<void>;
  /** Runs as render.export builds its approval card (something else writing the timeline just then). */
  beforeExportCard?: () => void;
}

export function createWorld(options: Partial<Pick<World, 'qa' | 'rerankUsd'>> = {}): World {
  return {
    projectId: newId<'Project'>(),
    templates: new Map(),
    timelines: new Map(),
    renders: new Map(),
    qa: options.qa ?? [],
    reviews: 0,
    rerankUsd: options.rerankUsd ?? 0,
    exported: [],
    calls: [],
  };
}

/** The user changes a timeline (a swap on the cast board, a trim): its revision moves. */
export function userEdit(world: World, timelineId: string): number {
  const next = (world.timelines.get(timelineId) ?? 0) + 1;
  world.timelines.set(timelineId, next);
  return next;
}

/** RefVersions over the world, as the composition root's would read the stores. */
export function worldRefs(world: World) {
  return {
    async version(ref: { entity: string; id: string }) {
      const map =
        ref.entity === 'template'
          ? world.templates
          : ref.entity === 'timeline'
            ? world.timelines
            : world.renders;
      return ok(map.get(ref.id));
    },
  };
}

const ulid = z.string().regex(ULID_PATTERN);
const local = { costClass: 'local' as const, timeoutMs: 2_000, retry: NO_TOOL_RETRY };

/** `renderTools`: more render tools for the render module (AGT2: the Maker's render.draft stand-in). */
export function flowToolModules(world: World, renderTools: readonly AnyTool[] = []): ToolModule[] {
  const templates = defineToolModule({
    id: 'templates',
    tools: [
      defineTool({
        name: 'templates.breakdown',
        version: '1.0.0',
        description: 'Breaks a reference reel down into a stored template: cuts, beats, text, slots.',
        input: z.object({ reference: z.object({ kind: z.string(), url: z.string().optional() }).loose() }),
        output: z.object({ templateId: ulid, version: z.int(), slotCount: z.int() }),
        sideEffect: 'read',
        ...local,
        run: async () => {
          world.calls.push('templates.breakdown');
          const templateId = newId<'Template'>();
          world.templates.set(templateId, 1);
          return ok({ templateId, version: 1, slotCount: 4 });
        },
      }),
    ],
  });
  const timeline = defineToolModule({
    id: 'timeline',
    tools: [
      defineTool({
        name: 'timeline.cast',
        version: '1.0.0',
        description:
          "Casts the user's shots into a template or a brief's plan and assembles one timeline per variant.",
        input: z.object({
          templateId: ulid.optional(),
          brief: z.string().optional(),
          variants: z.int().min(1).max(10).default(1),
        }),
        output: z.object({
          timelineIds: z.array(ulid),
          revisions: z.array(z.int()),
          templateId: ulid,
          lowConfidenceSlots: z.int(),
          reranked: z.int(),
        }),
        sideEffect: 'read',
        ...local,
        run: async (input) => {
          world.calls.push(`timeline.cast:${input.variants}`);
          const templateId = input.templateId ?? newId<'Template'>();
          if (!world.templates.has(templateId)) world.templates.set(templateId, 1);
          const timelineIds = Array.from({ length: input.variants }, () => newId<'Timeline'>());
          for (const id of timelineIds) world.timelines.set(id, 1);
          return ok({
            timelineIds,
            revisions: timelineIds.map(() => 1),
            templateId,
            lowConfidenceSlots: 1,
            reranked: 0,
          });
        },
      }),
      defineTool({
        name: 'timeline.rerank',
        version: '1.0.0',
        description: 'Reranks unsure slots by showing their candidate thumbnails to the vision model.',
        input: z.object({ slots: z.int().min(1).max(20) }),
        output: z.object({ reranked: z.int() }),
        costClass: 'cloud',
        sideEffect: 'read',
        timeoutMs: 2_000,
        retry: NO_TOOL_RETRY,
        permission: { network: 'internet', cloudModules: ['vision'] },
        estimateCost: (input) => ({ usd: 0.01 * input.slots, tokens: 1_000 * input.slots }),
        run: async (input, ctx) => {
          world.calls.push('timeline.rerank');
          ctx.reportUsage({ usd: world.rerankUsd, inputTokens: 900 * input.slots, outputTokens: 50 });
          return ok({ reranked: input.slots });
        },
      }),
      defineTool({
        name: 'timeline.trimClip',
        version: '1.0.0',
        description: 'Trims a clip of a timeline onto its beat. Undoable.',
        input: z.object({ timelineId: ulid }),
        output: z.object({ timelineId: ulid, revision: z.int() }),
        sideEffect: 'write',
        command: 'timeline.trimClip',
        idempotencyKey: (input) => `${input.timelineId}:${world.timelines.get(input.timelineId) ?? 0}`,
        ...local,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          if (!done.ok) return done;
          world.calls.push('timeline.trimClip');
          const revision = userEdit(world, input.timelineId);
          return ok({ timelineId: input.timelineId, revision });
        },
      }),
    ],
  });
  return [templates, timeline, renderModule(world, renderTools), libraryModule(world)];
}

function renderModule(world: World, more: readonly AnyTool[]): ToolModule {
  const exportInput = z.object({ projectId: ulid, timelineId: ulid, timelineRevision: z.int().min(1) });
  return defineToolModule({
    id: 'render',
    tools: [
      defineTool({
        name: 'render.review',
        version: '1.0.0',
        description: 'Renders a draft of a timeline and runs every QA check on it.',
        input: z.object({ timelineId: ulid }),
        output: z.object({ renderId: ulid, passed: z.boolean() }),
        sideEffect: 'read',
        ...local,
        run: async () => {
          world.calls.push('render.review');
          const passed = world.qa[world.reviews] ?? true;
          world.reviews += 1;
          const renderId = newId<'Render'>();
          world.renders.set(renderId, world.reviews);
          return ok({ renderId, passed });
        },
      }),
      defineTool({
        name: 'render.export',
        version: '1.0.0',
        description: 'Exports the reviewed timeline with the project export settings.',
        input: exportInput,
        // As render's: the render (what export.completed reads) beside its id.
        output: z.object({ renderId: ulid, render: z.record(z.string(), z.unknown()) }),
        sideEffect: 'write',
        command: 'render.export',
        checkpoint: true,
        idempotencyKey: (input) => `${input.timelineId}:${input.timelineRevision}`,
        ...local,
        approvalCard: async (input, ctx) => {
          world.beforeExportCard?.();
          return world.timelines.get(input.timelineId) !== input.timelineRevision
            ? err(ConflictError({ entity: 'timeline', id: input.timelineId }))
            : ok({
                type: 'exportApproval',
                id: `render-export-${input.timelineId}`,
                version: 1,
                runId: ctx.runId,
                approvalId: ctx.approvalId,
                projectId: input.projectId as ProjectId,
                timelineId: input.timelineId as never,
                timelineRevision: input.timelineRevision,
                presetId: 'reels',
                presets: ['shorts', 'reels', 'tiktok'],
                captions: { burnIn: true, sidecars: [] },
                music: 'platformSound',
                draft: null,
                status: 'pending',
              });
        },
        resultCard: async (output, ctx) =>
          ok({
            type: 'renderProgress',
            id: `render-${output.renderId}`,
            version: 1,
            runId: ctx.runId,
            renderId: output.renderId as never,
            projectId: (ctx.projectId ?? world.projectId) as ProjectId,
            presetId: 'reels',
            status: 'ready',
            progress: null,
            notify: false,
            qa: null,
          }),
        run: async (input, ctx) => {
          await world.beforeExport?.();
          if (world.timelines.get(input.timelineId) !== input.timelineRevision)
            return err(ConflictError({ entity: 'timeline', id: input.timelineId }));
          const done = await ctx.dispatch(input);
          if (!done.ok) return done;
          world.exported.push({ timelineId: input.timelineId, revision: input.timelineRevision });
          const renderId = newId<'Render'>();
          const render = {
            id: renderId,
            projectId: input.projectId,
            timelineId: input.timelineId,
            presetId: 'reels',
            music: 'platformSound',
            durationFrames: 900,
            rate: { num: 30, den: 1 },
            createdAt: 1_000,
            finishedAt: 13_500,
          };
          return ok({ renderId, render });
        },
      }),
      ...more,
    ],
  });
}

function libraryModule(world: World): ToolModule {
  return defineToolModule({
    id: 'library',
    tools: [
      defineTool({
        name: 'library.listSources',
        version: '1.0.0',
        description: "Lists the user's footage sources with their newest captures.",
        input: z.object({}),
        output: z.object({ sources: z.array(z.object({ name: z.string(), newest: z.string() })) }),
        sideEffect: 'read',
        ...local,
        run: async () => {
          world.calls.push('library.listSources');
          return ok({ sources: [{ name: 'Phone', newest: 'Goa, 12 Oct, 48 clips' }] });
        },
      }),
    ],
  });
}
