// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: the Maker makes the video in the flow. Where it is composed it runs after the Librarian in place of the
 * Editor, and the Reviewer stays the last gate before the export. Its rounds end with a draft; each draft is followed
 * by a note of the round, and the drafts it may render follow the model's window. A review's fixes go back to it.
 * The eyes and match lanes' tools are stand-ins here, by their fixed names (video.compare, video.done).
 */
import {
  defineSkill,
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  ULID_PATTERN,
  unwrap,
  type AnySkill,
  type AnyTool,
} from '@taalcut/core';
import type { AgentEvent, ModelScript } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flowHarness } from '../support/flow-harness';
import { flowScript, skillTurn, text } from '../support/flow-script';
import { createWorld, type World } from '../support/flow-world';
import { call, ofType } from '../support/harness';

const ulid = z.string().regex(ULID_PATTERN);
const local = { costClass: 'local' as const, timeoutMs: 2_000, retry: NO_TOOL_RETRY };
const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };

/** render.draft, as a stand-in over the world. */
function draftTool(world: World): AnyTool {
  return defineTool({
    name: 'render.draft',
    version: '1.0.0',
    description: 'Renders a QA-checked draft of one timeline revision.',
    input: z.object({ timelineId: ulid, revision: z.int().min(1) }),
    output: z.object({
      render: z.object({ id: ulid }),
      timelineRevision: z.int(),
      passed: z.boolean(),
      failing: z.array(z.object({ id: z.string() })),
    }),
    sideEffect: 'write',
    command: 'render.export',
    // Each draft renders again (the real one renders a revision once; the stand-in counts rounds).
    idempotencyKey: (input) => `${input.timelineId}:${input.revision}:${world.calls.length}`,
    ...local,
    run: async (input) => {
      world.calls.push('render.draft');
      const id = newId<'Render'>();
      world.renders.set(id, 1);
      const passed = world.calls.filter((c) => c === 'render.draft').length > 1;
      return ok({
        render: { id },
        timelineRevision: input.revision,
        passed,
        failing: passed ? [] : [{ id: 'beatSync' }],
      });
    },
  }) as AnyTool;
}

/** The other lanes' tools, by their fixed names, as stand-ins. */
function videoTools(world: World) {
  return defineToolModule({
    id: 'video',
    tools: [
      ...['video.compare', 'video.done'].map((name) =>
        defineTool({
          name,
          version: '1.0.0',
          description: `Stand-in for ${name}.`,
          input: z.object({ timelineId: ulid }),
          output: z.object({ ok: z.boolean() }),
          sideEffect: 'read',
          ...local,
          run: async () => {
            world.calls.push(name);
            return ok({ ok: true });
          },
        }),
      ),
    ],
  });
}

const maker = defineSkill({
  id: 'timeline.maker',
  version: '1.0.0',
  labelKey: 'skills.timeline.maker',
  description: 'Makes the video, drafts it, compares it with the reel and fixes it.',
  prompt: 'Edit, draft, compare, fix, then video.done and hand off.',
  tools: { names: ['timeline.trimClip', 'render.draft', 'video.compare', 'video.done'] },
  input: z.object({
    projectId: ulid,
    timelineId: ulid,
    templateId: ulid,
    fixes: z.array(z.unknown()).optional(),
  }),
  output: z.object({ timelineId: ulid, revision: z.int().min(1), renderId: ulid.optional() }),
  refs: (out) => [{ entity: 'timeline', id: out.timelineId, version: out.revision }],
  limits: { maxTurns: 12 },
});

/** The Maker trims, then drafts `drafts` times (each followed by a compare), then calls video.done and hands off. */
function script(drafts: number): ModelScript {
  const others = flowScript({ ask: false });
  return (request, turn) => {
    if (!/# Skill: timeline\.maker/.test(request.system ?? '')) return others(request, turn);
    const at = skillTurn(request);
    const timelineId = at.input.timelineId;
    // The revision the trim returned (a later round trims again).
    const revision = (at.results.find((r) => typeof r.revision === 'number')?.revision as number) ?? 2;
    const steps = [
      call('timeline_trimClip', { timelineId }),
      ...Array.from({ length: drafts }, () => call('render_draft', { timelineId, revision })),
      call('video_done', { timelineId }),
    ];
    if (at.turn < steps.length) return { toolCalls: [steps[at.turn]!] };
    return { toolCalls: [call('handOff', { timelineId, revision })] };
  };
}

async function make(drafts: number, window?: number, qa: boolean[] = []) {
  const world = createWorld({ qa });
  const h = flowHarness({
    world,
    script: script(drafts),
    settings: { autonomy: 'autopilot' },
    extra: {
      tools: [videoTools(world)],
      renderTools: [draftTool(world)],
    },
    skills: { maker: maker as unknown as AnySkill },
    ...(window ? { deps: { contextWindow: () => window } } : {}),
  });
  const runId = unwrap(
    await h.agent.start({
      conversationId: 'c1',
      projectId: world.projectId,
      message: 'Copy this reel',
      start: { path: 'reference', reference: reel },
    }),
  );
  const outcome = unwrap(await h.agent.wait(runId));
  return { h, world, outcome, events: await h.events(runId) };
}

const notes = (events: readonly AgentEvent[]) => ofType(events, 'step.progress').map((e) => e.payload.text);

describe('the Maker in the flow (AGT2)', () => {
  it('makes the video after the Librarian, in place of the Editor, and the Reviewer gates the export', async () => {
    const { events, outcome } = await make(1);
    expect(outcome.status).toBe('completed');
    expect(ofType(events, 'plan.created')[0]?.payload.steps.map((s) => s.skill ?? s.tool)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.maker',
      'render.reviewer',
      'render.export',
    ]);
    expect(ofType(events, 'skill.entered').map((e) => e.payload.skill)).not.toContain('timeline.editor');
  });

  it('notes each round after its draft, and the next turn reads the note', async () => {
    const { events, h } = await make(2);
    const [first, second] = notes(events);
    expect(first).toMatch(/^Round 1: draft \S+ of revision 2, QA failed: beatSync\. 1 draft left/);
    expect(second).toMatch(/^Round 2: draft \S+ of revision 2, QA passed\. No drafts left/);
    const makerTurns = h.models.requests.filter((r) => /# Skill: timeline\.maker/.test(r.system ?? ''));
    const read = makerTurns.at(-1)!.messages.map(text);
    expect(read.some((m) => m.includes('Round 1:'))).toBe(true);
    expect(read.some((m) => m.includes('Round 2:'))).toBe(true);
  });

  it('refuses a draft past the 4B’s budget, saying what to do instead', async () => {
    const { events, world } = await make(3);
    expect(world.calls.filter((c) => c === 'render.draft')).toHaveLength(2);
    const refused = ofType(events, 'tool.failed').map((e) => e.payload.error);
    expect(refused).toEqual([
      expect.objectContaining({
        code: 'agent.outside_skill',
        detail: expect.stringMatching(/2 drafts are used/),
      }),
    ]);
    expect(world.calls).toContain('video.done');
  });

  it('gives a cloud model more drafts and turns', async () => {
    const { events, world } = await make(3, 200_000);
    expect(world.calls.filter((c) => c === 'render.draft')).toHaveLength(3);
    expect(notes(events)[2]).toMatch(/^Round 3: .* 5 drafts left/);
    const route = ofType(events, 'route.chosen').find((e) => e.payload.stepId === 'f3')?.payload;
    expect(route).toMatchObject({ window: 200_000 });
    expect(route?.tools).toEqual(['timeline.trimClip', 'render.draft', 'video.compare', 'video.done']);
  });

  it('sends a review’s fixes back to the Maker', async () => {
    const { events } = await make(1, undefined, [false, true]);
    const steps = ofType(events, 'plan.updated').flatMap((e) => e.payload.steps);
    expect(steps.map((s) => [s.skill ?? s.tool, s.flow?.key, s.flow?.fixes !== undefined])).toEqual([
      ['timeline.maker', 'maker', true],
      ['render.reviewer', 'reviewer', false],
    ]);
  });
});
