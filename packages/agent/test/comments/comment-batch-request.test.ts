// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: a comment batch runs the Editor as a request. On the owner's run the batch's step had no request, so the
 * Editor ran as the make flow's finish with every edit a person asks for withheld, loaded its tools by its own
 * description alone, and answered "those editing controls aren't available". Here the Editor is shaped like the real
 * one (a request's tools withheld without one) and the batch's first turn already offers timeline.slipClip and
 * graphics.edit for comments that ask for them, with the reply; the slip points at the commented clip; and a replay of
 * an older batch run, whose plan asked nothing, still replays as it ran.
 */
import {
  commentReplyToolInputSchema,
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type CommentBatch,
  type ToolEditorContext,
} from '@taalcut/core';
import { createMemoryEventLogStore, createSkillRegistry, type ModelScript } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, registryFor } from '../support/harness';

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const [clipId, graphicId] = [newId<'TimelineItem'>(), newId<'TimelineItem'>()];
const [earlier, bubble] = [newId<'TimelineComment'>(), newId<'TimelineComment'>()];

const BATCH = {
  projectId,
  timelineId,
  revision: 3,
  rate: { num: 30, den: 1 },
  comments: [
    {
      commentId: earlier,
      on: 'clip',
      itemId: clipId,
      start: 0,
      end: 90,
      body: 'The footage should start a bit earlier, it ends badly',
    },
    {
      commentId: bubble,
      on: 'graphic',
      itemId: graphicId,
      start: 30,
      end: 90,
      body: 'The speech bubble shows the wrong name',
    },
  ],
} as CommentBatch;

const local = {
  costClass: 'local' as const,
  timeoutMs: 5_000,
  retry: NO_TOOL_RETRY,
  sideEffect: 'read' as const,
};
const done = z.object({ revision: z.int() });

function world() {
  const slips: { input: unknown; editor: ToolEditorContext | undefined }[] = [];
  const replies: string[] = [];
  const edit = (name: string, description: string, tags: string[], revision = 4) =>
    defineTool({
      name,
      version: '1.0.0',
      description,
      tags,
      input: z.object({ clip: z.union([z.string(), z.int()]).optional(), part: z.unknown().optional() }),
      output: done,
      ...local,
      run: async (input, ctx) => {
        if (name === 'timeline.slipClip') slips.push({ input, editor: ctx.editor });
        return ok({ revision });
      },
    });
  const modules = [
    defineToolModule({
      id: 'timeline',
      tools: [
        edit('timeline.get', 'Gets the timeline with its locks: clips, texts and sounds.', ['read']),
        edit('timeline.trimClip', 'Makes a clip longer or shorter.', ['trim', 'longer', 'shorter']),
        edit(
          'timeline.slipClip',
          'Plays an earlier or later part of a clip’s shot for the same length: past a slow start, before it ends.',
          ['slip', 'earlier', 'later', 'start', 'end'],
        ),
        edit('timeline.trimToDuration', 'Trims the whole video to a length.', ['length']),
      ],
    }),
    defineToolModule({
      id: 'templates',
      tools: [edit('templates.styleProfile', 'Reads the project’s style set.', ['style'])],
    }),
    defineToolModule({
      id: 'graphics',
      tools: [
        edit('graphics.list', 'Lists the graphics on the timeline.', ['list']),
        edit(
          'graphics.edit',
          'Moves, resizes, rewords or retimes a graphic: a speech bubble, a lower third, a title.',
          ['words', 'name', 'bubble'],
          5,
        ),
        edit('graphics.design', 'Asks the Designer for a new graphic or a new look for one.', ['look']),
      ],
    }),
    defineToolModule({
      id: 'comments',
      tools: [
        edit('comments.list', 'Reads a timeline’s comments.', ['read']),
        defineTool({
          name: 'comments.reply',
          version: '1.0.0',
          description: 'Answers one comment.',
          input: commentReplyToolInputSchema,
          output: z.object({ commentId: z.string() }),
          ...local,
          run: async ({ commentId }) => (replies.push(commentId), ok({ commentId })),
        }),
      ],
    }),
  ];
  return { modules, slips, replies };
}

const REQUEST_ONLY = ['timeline.slipClip', 'graphics.list', 'graphics.edit', 'graphics.design'];
const timelineInput = { projectId: ulid, timelineId: ulid, templateId: ulid.optional() };

/** The Editor as EDT1 shipped it (`asks: false`: no request in its input, as an older batch's plan logged) or now. */
function editorSkill(asks: boolean) {
  return defineSkill({
    id: 'timeline.editor',
    version: asks ? '2.2.0' : '2.1.0',
    labelKey: 'skills.timeline.editor',
    description:
      "Gets the timeline and its locks, then does what the editor's chat says, or finishes an assembled video.",
    prompt: 'Make each change, answer each comment, then hand off.',
    tools: {
      names: [
        'timeline.get',
        'timeline.trimClip',
        'timeline.trimToDuration',
        'templates.styleProfile',
        ...REQUEST_ONLY,
      ],
      families: ['comments'],
    },
    withheldTools: (input) =>
      (input as { request?: string }).request ? ['templates.styleProfile'] : REQUEST_ONLY,
    input: asks
      ? z.object({
          ...timelineInput,
          request: z.string().max(2000).optional(),
          context: z.unknown().optional(),
          targets: z.array(z.unknown()).optional(),
        })
      : z.object(timelineInput),
    output: z.object({ timelineId: ulid, revision: z.int().min(1) }),
    refs: (out) => [{ entity: 'timeline', id: out.timelineId, version: out.revision }],
  });
}

const reply = (commentId: string, words: string) =>
  call('comments_reply', { commentId, reply: words, status: 'resolved' });

/** The Editor's turns: `steps[n]` on its n-th turn; the last repeats. */
const editorTurns =
  (...steps: ReturnType<typeof call>[][]): ModelScript =>
  (request, turn) => {
    if (!/# Skill: timeline\.editor\b/.test(request.system ?? '')) return { text: 'Done.' };
    const calls = steps[Math.min(turn, steps.length - 1)]!;
    return calls.length ? { toolCalls: calls } : { text: 'Done.' };
  };

function setup(asks: boolean, script: ModelScript, store = createMemoryEventLogStore()) {
  const w = world();
  const skills = unwrap(
    createSkillRegistry(
      [defineSkillModule({ id: 'timeline', skills: [editorSkill(asks)] })],
      registryFor(w.modules),
    ),
  );
  return { ...w, ...harness({ script, modules: w.modules, deps: { skills }, store }) };
}

const run = (s: ReturnType<typeof setup>) =>
  s.agent.run({
    conversationId: 'c',
    projectId,
    message: 'Please make the changes in my 2 comments.',
    comments: BATCH,
  });

describe('a comment batch is the Editor’s request (FIX-CMT)', () => {
  it('offers slipClip and graphics.edit on the first turn, with the reply, pointing at the commented clip', async () => {
    const s = setup(
      true,
      editorTurns(
        [
          call('timeline_slipClip', { clip: 'this', part: { seconds: -1 } }),
          reply(earlier, 'It starts a second earlier now.'),
        ],
        [call('graphics_edit', {}), reply(bubble, 'The bubble has the right words now.')],
        [call('handOff', { timelineId, revision: 5 })],
      ),
    );
    const outcome = unwrap(await run(s));
    expect(outcome.status).toBe('completed');
    const events = await s.events(outcome.runId);
    const step = ofType(events, 'plan.created')[0]!.payload.steps[0]!;
    expect(step).toMatchObject({ id: 'comments', text: '', labelKey: 'flows.step.comments' });
    const input = step.input as { request: string; context: { selection: unknown[] }; targets: unknown[] };
    expect(input.request).toContain(
      '<untrusted source="user-comment">\nThe footage should start a bit earlier, it ends badly\n</untrusted>',
    );
    expect(input.context.selection).toHaveLength(2);
    expect(input.targets).toHaveLength(2);

    // The step is found by the comments' words, so its first turn already has the tools they need.
    const route = ofType(events, 'route.chosen')[0]!.payload;
    expect(route.query).toContain('start a bit earlier');
    expect(route.tools).toEqual(
      expect.arrayContaining(['timeline.slipClip', 'graphics.edit', 'timeline.get', 'comments.reply']),
    );
    // By the comments' words alone, the graphic's edit tool first: never the Editor's description's whole-video trim.
    expect(route.query).not.toContain('finishes an assembled video');
    expect(route.tools[0]).toBe('graphics.edit');
    expect(route.tools).not.toContain('timeline.trimToDuration');
    const first = s.models.requests.find((request) =>
      /# Skill: timeline\.editor\b/.test(request.system ?? ''),
    )!;
    const offered = (first.tools ?? []).map((tool) => tool.name);
    expect(offered).toEqual(expect.arrayContaining(['timeline_slipClip', 'graphics_edit', 'comments_reply']));
    expect(offered).not.toContain('templates_styleProfile');

    // "this" is the commented clip: the slip's tools see what the comments are on.
    expect(s.slips).toHaveLength(1);
    expect(s.slips[0]!.input).toEqual({ clip: 'this', part: { seconds: -1 } });
    expect(s.slips[0]!.editor?.context.selection[0]).toEqual({
      kind: 'item',
      timelineId,
      itemId: clipId,
      itemKind: 'clip',
    });
    expect(s.slips[0]!.editor?.targets.map((target) => target.itemId)).toEqual([clipId, graphicId]);
    expect(s.replies).toEqual([earlier, bubble]);
  });

  it('replays an older batch run, whose plan asked nothing, as it ran', async () => {
    const store = createMemoryEventLogStore();
    const old = setup(
      false,
      editorTurns(
        [call('timeline_trimToDuration', {}), reply(earlier, 'Kept.')],
        [reply(bubble, 'Kept.')],
        [call('handOff', { timelineId, revision: 4 })],
      ),
      store,
    );
    const outcome = unwrap(await run(old));
    const logged = ofType(await old.events(outcome.runId), 'plan.created')[0]!.payload.steps[0]!;
    expect(logged.input).toEqual({ projectId, timelineId });

    // Today's Editor asks; the old run's plan is replayed as logged, in finish mode, prompt for prompt.
    const now = setup(true, () => ({ text: 'unused' }), store);
    const replayed = unwrap(await now.agent.replay(outcome.runId));
    expect(replayed.status).toBe(outcome.status);
    expect(replayed.toolCalls.map((c) => c.tool)).toEqual([
      'timeline.trimToDuration',
      'comments.reply',
      'comments.reply',
    ]);
    expect(replayed.promptDrift).toBe(0);
  });
});
