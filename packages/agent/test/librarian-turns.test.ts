// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-LIBRARIAN: "Make a video with my template", as it failed for the owner. The template has 13 slots; casting
 * fills 11, all under the confidence line and none with an alternate (the footage is the other orientation), and
 * leaves 2 open. A model that explores spends the Librarian's turns the way the owner's did: a plan update naming
 * the Librarian, the variants question, the cast, a tool search for vision, the cast's artifact, a tool search for
 * asset profiles, a profile of every unsure shot in one turn (looking for a file path to show vision), another
 * search, the assembly on its 9th turn, and a read of the new timeline on its 10th. The Librarian had no turn limit
 * of its own, so the loop's 10 ended the step before its handoff and the video it had made was thrown away
 * (`agent.turn_limit`).
 *
 * A skill step's last turn now offers only handOff, so the step hands off what it made and the flow goes on to the
 * export; a step that made nothing still stops at its limit. The plan update is refused (a skill step can't plan
 * another skill), so no second Librarian is left waiting after the export with no input.
 */
import {
  artifactRefSchema,
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  ULID_PATTERN,
  unwrap,
  type AnyTool,
  type SkillModule,
  type ToolModule,
} from '@taalcut/core';
import {
  agentSkillModule,
  CONTROL_PREFIX,
  createSkillRegistry,
  SKILL_INPUT_NOTE,
  type ModelScript,
  type ScriptedReply,
} from '@taalcut/agent';
import type { ModelRequest } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flowScript, json, text } from './support/flow-script';
import { flowSkillModules } from './support/flow-skills';
import { createWorld, flowToolModules, worldRefs, type World } from './support/flow-world';
import { call, harness, ofType, registryFor } from './support/harness';

const SLOTS = 13;
const FILLED = 11;
const ulid = z.string().regex(ULID_PATTERN);
const local = { costClass: 'local' as const, timeoutMs: 2_000, retry: NO_TOOL_RETRY };
const castInput = z.object({
  projectId: ulid,
  template: z.object({ id: ulid }),
  variants: z.int().min(1).max(10).default(1),
});

/** The owner's cast: 11 slots filled under the confidence line, none with an alternate, and 2 left open. */
function ownerSlots() {
  return Array.from({ length: SLOTS }, (_, index) =>
    index < FILLED
      ? {
          slotId: newId<'TemplateSlot'>(),
          shotId: newId<'Shot'>(),
          assetId: newId<'Asset'>(),
          confidence: 0.2,
          needsRerank: true,
          note: 'orientationRelaxed',
          alternates: [],
        }
      : {
          slotId: newId<'TemplateSlot'>(),
          shotId: null,
          assetId: null,
          confidence: null,
          needsRerank: false,
          note: 'noCandidates',
          alternates: [],
        },
  );
}

/** Stand-ins shaped like timeline's cast, assemble and get, and library's getAsset, over the flow world. */
function ownerTools(world: World): { timeline: AnyTool[]; library: AnyTool[] } {
  const slots = ownerSlots();
  const cast = defineTool({
    name: 'timeline.cast',
    version: '1.0.0',
    description: "Casts the user's library into a template: per slot a pick, alternates and a confidence.",
    input: castInput,
    output: z.object({
      castId: ulid,
      variants: z.array(z.object({ sequenceConfidence: z.number(), slots: z.array(z.unknown()) })),
      artifact: artifactRefSchema,
    }),
    sideEffect: 'read',
    ...local,
    run: async (_input, ctx) => {
      world.calls.push('timeline.cast');
      const answer = { castId: newId<'Cast'>(), variants: [{ sequenceConfidence: 0.002, slots }] };
      const stored = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(answer),
        summary: `Cast ${answer.castId}: 1 variant of ${SLOTS} slots.`,
      });
      return stored.ok ? ok({ ...answer, artifact: stored.value }) : stored;
    },
  });
  const assemble = defineTool({
    name: 'timeline.assemble',
    version: '1.1.0',
    description: 'Casts again and assembles one timeline per variant, in one undoable step.',
    input: castInput,
    output: z.object({
      castId: ulid,
      timelineIds: z.array(ulid),
      revisions: z.array(z.int()),
      lowConfidence: z.int(),
    }),
    sideEffect: 'write',
    command: 'timeline.create',
    idempotencyKey: (input) => `assemble:${input.template.id}:${input.variants}`,
    ...local,
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      if (!done.ok) return done;
      world.calls.push('timeline.assemble');
      const timelineId = newId<'Timeline'>();
      world.timelines.set(timelineId, 1);
      return ok({
        castId: newId<'Cast'>(),
        timelineIds: [timelineId],
        revisions: [1],
        lowConfidence: FILLED,
      });
    },
  });
  const get = defineTool({
    name: 'timeline.get',
    version: '1.0.0',
    description: 'Reads a timeline: its clips in order and its text items.',
    input: z.object({ timelineId: ulid }),
    output: z.object({ id: ulid, revision: z.int(), clips: z.int() }),
    sideEffect: 'read',
    ...local,
    run: async (input) =>
      ok({ id: input.timelineId, revision: world.timelines.get(input.timelineId) ?? 0, clips: FILLED }),
  });
  const getAsset = defineTool({
    name: 'library.getAsset',
    version: '1.1.0',
    description: "One file's profile: facts, shots, transcript and copies.",
    input: z.object({ assetId: ulid, include: z.array(z.enum(['shots', 'locations'])).optional() }),
    output: z.object({
      asset: z.object({ id: ulid, orientation: z.string() }),
      locations: z.array(z.object({ relativePath: z.string(), storage: z.string() })),
    }),
    sideEffect: 'read',
    ...local,
    run: async (input) =>
      ok({
        asset: { id: input.assetId, orientation: 'portrait' },
        locations: [{ relativePath: `2026/${input.assetId}.mp4`, storage: 'managed' }],
      }),
  });
  return { timeline: [cast, assemble, get] as AnyTool[], library: [getAsset as AnyTool] };
}

function ownerModules(world: World): ToolModule[] {
  const owner = ownerTools(world);
  return flowToolModules(world).map((module) =>
    module.id === 'timeline'
      ? defineToolModule({
          id: 'timeline',
          tools: [...module.tools.filter((t) => t.name !== 'timeline.cast'), ...owner.timeline],
        })
      : module.id === 'library'
        ? defineToolModule({ id: 'library', tools: [...module.tools, ...owner.library] })
        : module,
  );
}

/** The Librarian's contract as timeline.librarian 1.3.0 declared it: an estimate of 6 turns and no limit of its own. */
function ownerSkills(world: World): SkillModule[] {
  const librarian = defineSkill({
    id: 'timeline.librarian',
    version: '1.3.0',
    labelKey: 'skills.timeline.librarian',
    description:
      "Casts the user's shots into a template (or a brief's format plan), reranks unsure slots, and assembles 1–10 variants.",
    prompt:
      'Cast the template, rerank the unsure slots, assemble, then hand off the timelines and their revisions.',
    tools: { families: ['timeline'], names: ['library.getAsset'] },
    input: z.object({ projectId: ulid, templateId: ulid }),
    output: z.object({
      templateId: ulid,
      timelineIds: z.array(ulid).min(1).max(10),
      revisions: z.array(z.int().min(1)).min(1).max(10),
      lowConfidenceSlots: z.int().nonnegative(),
      reranked: z.int().nonnegative(),
    }),
    questions: ['variants'],
    limits: { expectedTurns: 6 },
    refs: (out) =>
      out.timelineIds.map((id, i) => ({ entity: 'timeline', id, version: out.revisions[i] ?? 1 })),
    async verify(out) {
      const stale = out.timelineIds.find((id, i) => world.timelines.get(id) !== out.revisions[i]);
      return ok(stale ? { verdict: 'retry', reason: `Timeline ${stale} moved on.` } : { verdict: 'pass' });
    },
  });
  const stand = flowSkillModules(world);
  const editor = stand.find((m) => m.id === 'timeline')!.skills.find((s) => s.id === 'timeline.editor')!;
  return [
    defineSkillModule({ id: 'timeline', skills: [librarian, editor] }),
    ...stand.filter((m) => m.id === 'render'),
    agentSkillModule(),
  ];
}

/** The Librarian step's input and what its tools answered so far, read from the request as a model would. */
function librarianView(request: ModelRequest) {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const at = request.messages.findLastIndex((m) => m.role === 'user' && text(m).startsWith(marker));
  const after = request.messages.slice(at + 1);
  return {
    input: json(text(request.messages[at]).slice(marker.length).trim()),
    turn: after.filter((m) => m.role === 'assistant').length,
    results: after.filter((m) => m.role === 'tool').map((m) => json(text(m))),
    offered: (request.tools ?? []).map((t) => t.name),
  };
}

/**
 * The owner's model: it explores for nine turns, assembling on the ninth, then keeps reading the timeline back. It
 * hands off when handOff is all it has left, with what the assembly returned; with nothing made, it says so.
 */
function explorer(options: { assemble: boolean }): ModelScript {
  const flow = flowScript({ ask: false });
  return (request, turn) => {
    if (!/# Skill: timeline\.librarian\b/.test(request.system ?? '')) return flow(request, turn);
    const at = librarianView(request);
    const target = { projectId: at.input.projectId, template: { id: at.input.templateId }, variants: 1 };
    const assembled = at.results.findLast((r) => Array.isArray(r.timelineIds));
    if (at.offered.length === 1 && at.offered[0] === 'handOff') {
      if (!assembled) return { text: 'I could not make the video.' };
      return {
        toolCalls: [
          call('handOff', {
            templateId: at.input.templateId,
            timelineIds: assembled.timelineIds,
            revisions: assembled.revisions,
            lowConfidenceSlots: assembled.lowConfidence,
            reranked: 0,
          }),
        ],
      };
    }
    const cast = at.results.find((r) => Array.isArray(r.variants));
    const unsure = (
      (cast?.variants as { slots: { assetId: string | null }[] }[] | undefined)?.[0]?.slots ?? []
    ).flatMap((slot) => (slot.assetId ? [slot.assetId] : []));
    const turns: (() => ScriptedReply)[] = [
      () => ({
        toolCalls: [
          call('updatePlan', {
            steps: [
              {
                text: 'Choose the version count, match your footage, save the video.',
                skill: 'timeline.librarian',
              },
            ],
          }),
        ],
      }),
      () => ({ toolCalls: [call('askUser', { question: 'variants', suggested: 1 })] }),
      () => ({ toolCalls: [call('timeline_cast', target)] }),
      () => ({ toolCalls: [call('findTools', { query: 'vision.describeFrame' })] }),
      () => ({
        toolCalls: [call('readArtifact', { id: (cast?.artifact as { id: string }).id, limit: 8192 })],
      }),
      () => ({ toolCalls: [call('findTools', { query: 'library.getAsset' })] }),
      () => ({
        toolCalls: unsure.map((assetId) => call('library_getAsset', { assetId, include: ['locations'] })),
      }),
      () => ({ toolCalls: [call('findTools', { query: 'absolute local file path of a library clip' })] }),
      () => ({
        toolCalls: [
          call(
            options.assemble ? 'timeline_assemble' : 'findTools',
            options.assemble ? target : { query: 'frames' },
          ),
        ],
      }),
    ];
    const next = turns[at.turn];
    if (next) return next();
    const timelineId = (assembled?.timelineIds as string[] | undefined)?.[0];
    return {
      toolCalls: [timelineId ? call('timeline_get', { timelineId }) : call('findTools', { query: 'frames' })],
    };
  };
}

function ownerHarness(script: ModelScript) {
  const world = createWorld();
  const modules = ownerModules(world);
  const skills = unwrap(createSkillRegistry(ownerSkills(world), registryFor(modules)));
  const h = harness({
    script,
    modules,
    settings: { autonomy: 'autopilot' },
    deps: { skills, refs: worldRefs(world), flows: { staleAfterMs: 5 } },
  });
  const templateId = newId<'Template'>();
  world.templates.set(templateId, 1);
  const run = () =>
    h.agent.run({
      conversationId: 'c',
      projectId: world.projectId,
      message: 'Make a video with my template',
      start: { path: 'template', templateId },
    });
  return { ...h, world, run };
}

const librarianRequests = (requests: readonly ModelRequest[]) =>
  requests.filter((r) => /# Skill: timeline\.librarian\b/.test(r.system ?? ''));

describe("the owner's template run: 13 slots, 11 unsure, a model that explores (FIX-LIBRARIAN)", () => {
  it('hands off the video it made on the step’s last turn, and the flow goes on to the export', async () => {
    const h = ownerHarness(explorer({ assemble: true }));
    const outcome = unwrap(await h.run());
    expect(outcome).toMatchObject({ status: 'completed' });
    const events = await h.events(outcome.runId);
    const [assembled] = [...h.world.timelines.keys()];
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'timeline.librarian');
    expect(handed?.payload.output).toMatchObject({
      timelineIds: [assembled],
      revisions: [1],
      lowConfidenceSlots: FILLED,
      reranked: 0,
    });
    // Ten turns, the loop's limit: the tenth offered only handOff.
    const asked = librarianRequests(h.models.requests);
    expect(asked).toHaveLength(10);
    expect(asked.at(-1)?.tools?.map((t) => t.name)).toEqual(['handOff']);
    expect(asked.at(-2)?.tools?.map((t) => t.name)).toContain('timeline_get');
    // The video goes on through the Editor and the Reviewer to its export.
    expect(h.world.exported).toEqual([{ timelineId: assembled, revision: 2 }]);
    // The plan update named the Librarian again: left out with a note (AGT1), so only the flow's Librarian ran.
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).not.toContain(
      'agent.flow_violation',
    );
    const planned = ofType(events, 'tool.completed').find((e) =>
      JSON.stringify(e.payload.output).includes('is left out of your list'),
    );
    expect(planned).toBeDefined();
    expect(
      ofType(events, 'skill.entered').filter((e) => e.payload.skill === 'timeline.librarian'),
    ).toHaveLength(1);
  });

  it('still stops a step that made nothing at its limit', async () => {
    const h = ownerHarness(explorer({ assemble: false }));
    const outcome = unwrap(await h.run());
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'agent.turn_limit', params: { limit: 10 } },
    });
    expect(h.world.exported).toEqual([]);
  });
});
