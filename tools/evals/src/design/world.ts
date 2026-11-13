// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One design case's world (HFW1 dsn): the made-up video in memory, render's graphics commands and the workspace's
 * on a real bus, a workspace over a scratch folder, artifacts in memory, and the Designer's tools as its step has
 * them: the workspace tools, graphics.list, comments.reply (recorded here) and the step's handOff, checked with
 * the Designer's own check (render checkDesigns) and sent back while it fails, as the agent does. A redesign case
 * starts with its graphic placed from a fixture design; a comment case with the comment open on it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  commentReplyToolInputSchema,
  commentReplyToolOutputSchema,
  commentToolViewSchema,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  defineTool,
  err,
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  ValidationError,
  type AnyTool,
  type ArtifactId,
  type ArtifactStore,
  type AsyncResult,
  type CommandOrigin,
  type ProjectId,
  type StoredArtifact,
  type Timeline,
  type TimelineId,
  type WorkspaceFramesInput,
  type WorkspaceFramesOutput,
} from '@taalcut/core';
import {
  checkDesigns,
  compositionToolModule,
  createCompositionCommands,
  designerInputSchema,
  designerOutputSchema,
  runDesignerLoop,
  workspaceToolModule,
  type DesignerInput,
  type DesignerOutput,
} from '@taalcut/render';
import type { DesignCase } from './cases';
import { diskWorkspace } from './workspace';

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'design');
const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:eval-design' };

export type FramesFn = (
  input: WorkspaceFramesInput,
  options: { readonly signal: AbortSignal },
) => AsyncResult<WorkspaceFramesOutput>;

export function memoryArtifacts(): ArtifactStore & { readonly all: Map<string, StoredArtifact> } {
  const all = new Map<string, StoredArtifact>();
  return {
    all,
    put: async (input) => {
      const data = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
      const ref = { id: newId<'Artifact'>(), mediaType: input.mediaType, bytes: data.byteLength, summary: input.summary };
      all.set(ref.id, { ref, data });
      return ok(ref);
    },
    get: async (id: ArtifactId) => {
      const found = all.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
}

export interface DesignWorld {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly timeline: () => Timeline;
  readonly tools: readonly AnyTool[];
  readonly artifacts: ReturnType<typeof memoryArtifacts>;
  readonly dispatch: (command: string, payload: unknown) => AsyncResult<unknown>;
  readonly input: DesignerInput;
  /** Its words to the Designer: the step's input, and the reference frame. */
  readonly task: string;
  readonly replies: { commentId: string; reply: string; status: string }[];
  readonly handoffs: DesignerOutput[];
  /** A redesign's graphic, placed before the case. */
  readonly before?: { readonly itemIds: readonly string[]; readonly compositionId: string; readonly entry: string };
  readonly store: ReturnType<typeof diskWorkspace>['store'];
}

/** Runs one tool as the loop does, for the world's own setup. */
async function setupCall(world: Pick<DesignWorld, 'tools' | 'artifacts' | 'dispatch'>, name: string, input: unknown) {
  const tool = world.tools.find((entry) => entry.name === name)!;
  const loop = await runDesignerLoop({
    model: {
      seesImages: false,
      turn: async (request) =>
        ok(
          request.messages.length === 1
            ? { text: '', calls: [{ id: 'setup', name, arguments: input as Record<string, unknown> }], model: 'setup', local: true }
            : { text: '', calls: [], model: 'setup', local: true },
        ),
    },
    tools: [tool],
    system: '',
    task: [{ type: 'text', text: 'setup' }],
    dispatch: world.dispatch,
    artifacts: world.artifacts,
    maxTurns: 2,
  });
  const call = loop.calls[0];
  if (!call?.ok) throw new Error(`setup ${name}: ${call?.code ?? 'no call'} ${call?.detail ?? ''}`);
  return call.output as Record<string, unknown>;
}

export async function designWorld(
  entry: DesignCase,
  options: {
    readonly root: string;
    readonly initial: Timeline;
    readonly timelines: Map<TimelineId, Timeline>;
    readonly frames: FramesFn;
  },
): Promise<DesignWorld> {
  const { initial, timelines: stored } = options;
  stored.set(initial.id, initial);
  const timelines = {
    get: async (id: Timeline['id']) => {
      const found = stored.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'timeline', id }));
    },
    update: async (id: Timeline['id'], mutate: (timeline: Timeline) => Timeline) => {
      const found = stored.get(id);
      if (!found) return err(NotFoundError({ entity: 'timeline', id }));
      const next = timelineSchema.parse({ ...mutate(found), revision: found.revision + 1 });
      stored.set(id, next);
      return ok(next);
    },
  };
  const workspace = diskWorkspace(options.root);
  const restore = defineCommand({
    name: TIMELINE_COMMANDS.restore,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ timelineId, tracks }) => {
      const updated = await timelines.update(timelineId, (timeline) => ({ ...timeline, ...(tracks ? { tracks } : {}) }));
      return updated.ok ? ok({ result: { revision: updated.value.revision } }) : updated;
    },
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
  bus.register(...createCompositionCommands({ timelines }).all, ...workspace.commands, restore);
  const dispatch = async (command: string, payload: unknown) => {
    const done = await bus.dispatch(command, payload, AGENT);
    return done.ok ? ok(done.value.result) : done;
  };
  const artifacts = memoryArtifacts();
  const commentId = entry.comment ? newId<'TimelineComment'>() : undefined;
  let commentOn: string | undefined;
  const replies: DesignWorld['replies'] = [];
  const handoffs: DesignerOutput[] = [];
  const workspaceTools = workspaceToolModule({
    store: workspace.store,
    timelines,
    frames: options.frames,
    designer: async () => ({ id: 'eval/designer', onDevice: false }),
    comments: async () =>
      ok(
        commentId && commentOn
          ? [commentToolViewSchema.parse({ commentId, status: 'open', on: 'graphic', itemId: commentOn, start: null, end: null, body: entry.request })]
          : [],
      ),
  }).tools;
  const list = compositionToolModule({ timelines }).tools.filter((tool) => tool.name === 'graphics.list');
  const reply = defineTool({
    name: 'comments.reply',
    version: '1.0.0',
    description: 'Answers one of the person’s comments: one line about what changed (resolved), or why not (open).',
    summary: 'Answers a comment.',
    tags: ['comments', 'reply'],
    input: commentReplyToolInputSchema,
    output: commentReplyToolOutputSchema,
    sideEffect: 'read',
    costClass: 'local',
    timeoutMs: 5_000,
    permission: { network: 'none' },
    retry: NO_TOOL_RETRY,
    run: async (input) => {
      if (input.commentId !== commentId) return err(NotFoundError({ entity: 'comment', id: input.commentId }));
      replies.push({ commentId: input.commentId, reply: input.reply, status: input.status });
      return ok({ commentId: input.commentId, status: input.status === 'resolved' ? 'resolved' : 'open' });
    },
  });
  // The step's input, made once the world is set up (a redesign's graphic is placed first).
  const step: { input?: DesignerInput } = {};
  const handOff = defineTool({
    name: 'handOff',
    version: '1.0.0',
    description: 'Ends your step with a result for every job (the Designer’s output).',
    summary: 'Ends the step.',
    tags: ['handoff'],
    input: designerOutputSchema,
    output: z.object({ accepted: z.boolean() }),
    sideEffect: 'read',
    costClass: 'local',
    timeoutMs: 5_000,
    permission: { network: 'none' },
    retry: NO_TOOL_RETRY,
    run: async (output) => {
      if (!step.input) return err(ValidationError({ field: 'handOff' }, { detail: 'No jobs yet' }));
      const verdict = checkDesigns(output, step.input, stored.get(initial.id)!);
      if (verdict.verdict !== 'pass')
        return err(ValidationError({ field: 'handOff' }, { detail: verdict.reason ?? 'Not yet' }));
      handoffs.push(output);
      return ok({ accepted: true });
    },
  });
  const tools = [...workspaceTools, ...list, reply as AnyTool, handOff as AnyTool];
  const projectId = initial.projectId as ProjectId;
  const world = { tools, artifacts, dispatch };
  let before: DesignWorld['before'];
  if (entry.before) {
    const text = await readFile(join(FIXTURES, entry.before.fixture), 'utf8');
    const folder = /data-composition-id="([^"]+)"/.exec(text)?.[1] ?? 'graphic';
    const path = `${folder}/index.html`;
    await setupCall(world, 'workspace.write', { projectId, path, text });
    const placed = await setupCall(world, 'workspace.place', {
      projectId,
      timelineId: initial.id,
      revision: initial.revision,
      entry: path,
      name: entry.before.name,
      request: entry.before.name,
      at: entry.before.at,
      params: entry.before.params,
    });
    before = { itemIds: placed.itemIds as string[], compositionId: placed.compositionId as string, entry: path };
    commentOn = before.itemIds[0];
  }
  let reference = '';
  if (entry.reference) {
    const text = await readFile(join(FIXTURES, entry.reference), 'utf8');
    const path = 'reference/index.html';
    await setupCall(world, 'workspace.write', { projectId, path, text });
    const drawn = await setupCall(world, 'workspace.render', { projectId, entry: path, seconds: [2] });
    const image = (drawn.frames as { image: { id: string } }[])[0]?.image.id;
    reference = image ? `\nThe person attached a reference frame: imageId ${image} (an image you can render over, or compare with).` : '';
  }
  const input = designerInputSchema.parse({
    projectId,
    timelineId: initial.id,
    jobs: [
      {
        jobId: 'job1',
        request: entry.request,
        ...(entry.at !== undefined && !before ? { at: entry.at } : {}),
        ...(entry.phrase && !before ? { phrase: entry.phrase } : {}),
        ...(before ? { itemIds: before.itemIds } : {}),
        ...(commentId ? { commentId } : {}),
      },
    ],
  });
  step.input = input;
  const task = `Your input:\n${JSON.stringify(input, null, 1)}${reference}\nEnd with handOff.`;
  return {
    projectId,
    timelineId: initial.id,
    timeline: () => stored.get(initial.id)!,
    tools,
    artifacts,
    dispatch,
    input,
    task,
    replies,
    handoffs,
    ...(before ? { before } : {}),
    store: workspace.store,
  };
}
