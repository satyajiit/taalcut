// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 2's agent contract: skills, how a chat starts and what it points at, and person-only commands. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  chatContract,
  chatStartSchema,
  CommandSourceRefused,
  defineCommand,
  defineSkill,
  defineSkillModule,
  entityRefSchema,
  MAX_SELECTIONS,
  newId,
  ok,
  PERSON_SOURCES,
  planStepSchema,
  questionAnswerSchema,
  selectionChipSchema,
  skillIdSchema,
  skillModuleProblems,
  skillSpecProblems,
  unwrap,
  type AnySkill,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';

const brief = defineSkill({
  id: 'agent.brief',
  version: '1.0.0',
  labelKey: 'skills.agent.brief',
  description: 'Turns the request into a short brief.',
  prompt: 'Write a brief: length, mood, number of shots.',
  tools: { families: ['library'] },
  input: z.object({ request: z.string() }),
  output: z.object({ brief: z.string(), seconds: z.int().min(5).max(180) }),
  refs: () => [],
  questions: ['variants'],
  limits: { expectedTurns: 2, maxTurns: 6 },
});

describe('skills', () => {
  it('accepts a well-formed skill and module', () => {
    expect(skillSpecProblems(brief)).toEqual([]);
    expect(skillModuleProblems(defineSkillModule({ id: 'agent', skills: [brief] }))).toEqual([]);
    expect(skillIdSchema.safeParse('templates.analyst').success).toBe(true);
    expect(skillIdSchema.safeParse('Templates.Analyst').success).toBe(false);
  });

  it('lists every problem with a skill', () => {
    const bad = {
      ...brief,
      id: 'Brief',
      version: '1.0',
      labelKey: ' ',
      description: '',
      prompt: '',
      tools: {},
      output: z.object({ when: z.date() }),
      questions: ['colour'],
      limits: { expectedTurns: 8, maxTurns: 0 },
    } as unknown as AnySkill;
    const problems = skillSpecProblems(bad).join('\n');
    for (const part of [
      "id must look like 'module.camelCase'",
      "version '1.0' is not semver",
      'labelKey is empty',
      'description is empty',
      'prompt is empty',
      'tools must name at least one tool or family',
      'output must convert to JSON Schema',
      "unknown question 'colour'",
      'limits.maxTurns must be a positive integer',
      'limits.expectedTurns must not exceed maxTurns',
    ])
      expect(problems).toContain(part);
    const notObject = { ...brief, input: z.string() } as unknown as AnySkill;
    expect(skillSpecProblems(notObject)).toContain('agent.brief: input must be a z.object');
  });

  it('checks a module: id, prefixes, duplicates and emptiness', () => {
    expect(skillModuleProblems({ id: 'Agent', skills: [] })).toEqual([
      "module 'Agent': id must be lowercase letters and digits",
      "module 'Agent': has no skills",
    ]);
    expect(skillModuleProblems({ id: 'timeline', skills: [brief, brief] })).toEqual([
      "agent.brief: id must start with 'timeline.'",
      "agent.brief: id must start with 'timeline.'",
      'agent.brief: declared twice',
    ]);
  });

  it('names skills and handoffs on plan steps', () => {
    const ref = { entity: 'template', id: 'tpl-1', version: 3 };
    expect(entityRefSchema.parse(ref)).toEqual(ref);
    expect(entityRefSchema.safeParse({ ...ref, entity: 'nope' }).success).toBe(false);
    const step = {
      id: 's1',
      text: 'Write the brief',
      status: 'pending',
      skill: 'agent.brief',
      labelKey: 'skills.agent.brief',
    };
    expect(planStepSchema.parse(step)).toEqual(step);
    expect(planStepSchema.safeParse({ ...step, skill: 'brief' }).success).toBe(false);
  });
});

describe('chat start and selections', () => {
  const send = chatContract.send['~orpc'].inputSchema!;

  it('starts each opening path, and only takes https reference links', () => {
    const templateId = newId<'Template'>();
    for (const start of [
      { path: 'library' },
      { path: 'describe' },
      { path: 'template', templateId },
      { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/abc' } },
      { path: 'reference', reference: { kind: 'file', path: '/Users/me/Movies/ref.mp4' } },
    ])
      expect(chatStartSchema.parse(start)).toEqual(start);
    const http = { path: 'reference', reference: { kind: 'link', url: 'http://example.com/reel' } };
    expect(chatStartSchema.safeParse(http).success).toBe(false);
    expect(chatStartSchema.safeParse({ path: 'template' }).success).toBe(false);
  });

  it('points at clips, ranges and slots, up to MAX_SELECTIONS', async () => {
    const timelineId = newId<'Timeline'>();
    const conversationId = newId<'Conversation'>();
    const slot = { kind: 'slot', templateId: newId<'Template'>(), slotId: newId<'TemplateSlot'>() };
    const clip = { kind: 'clip', timelineId, clipId: newId<'TimelineItem'>() };
    expect(selectionChipSchema.parse(slot)).toEqual(slot);
    expect(selectionChipSchema.safeParse({ ...slot, slotId: undefined, slotIndex: 2 }).success).toBe(false);
    const ok20 = await send['~standard'].validate({
      conversationId,
      text: 'tighter',
      selections: Array(MAX_SELECTIONS).fill(clip),
    });
    expect(ok20.issues).toBeUndefined();
    const over = await send['~standard'].validate({
      conversationId,
      text: 'tighter',
      selections: Array(MAX_SELECTIONS + 1).fill(clip),
    });
    expect(over.issues?.length).toBeGreaterThan(0);
  });

  it('answers a skill question with a bounded count', () => {
    expect(questionAnswerSchema.parse({ kind: 'variants', count: 3 })).toEqual({
      kind: 'variants',
      count: 3,
    });
    expect(questionAnswerSchema.safeParse({ kind: 'variants', count: 11 }).success).toBe(false);
  });
});

describe('person-only commands', () => {
  function capCommand() {
    let cap = 2;
    const setCap = defineCommand({
      name: 'budget.setDefaultCap',
      payload: z.object({ cap: z.number() }),
      sideEffect: 'write',
      sources: PERSON_SOURCES,
      handle: ({ cap: next }) => {
        const before = cap;
        cap = next;
        return ok({ result: next, inverse: { name: 'budget.setDefaultCap', payload: { cap: before } } });
      },
    });
    return { setCap, current: () => cap };
  }

  it('refuses the agent and MCP clients, and accepts a person', async () => {
    const { bus, store } = setupBus();
    const budget = capCommand();
    bus.register(budget.setCap);
    for (const source of ['agent', 'mcp'] as const) {
      const refused = await bus.dispatch('budget.setDefaultCap', { cap: 50 }, { source, actor: 'agent:r1' });
      expect(!refused.ok && CommandSourceRefused.is(refused.error)).toBe(true);
      expect(!refused.ok && refused.error.params).toEqual({ name: 'budget.setDefaultCap', source });
    }
    expect(store.entries()).toHaveLength(0);
    unwrap(await bus.dispatch(budget.setCap, { cap: 5 }, { source: 'shortcut', actor: 'user' }));
    expect(budget.current()).toBe(5);
  });

  it('keeps the rule for undo and redo', async () => {
    const { bus } = setupBus();
    const budget = capCommand();
    bus.register(budget.setCap);
    unwrap(await bus.dispatch(budget.setCap, { cap: 5 }, UI));
    const agentUndo = await bus.undo(null, { source: 'agent', actor: 'agent:r1' });
    expect(!agentUndo.ok && agentUndo.error.code).toBe('core.command_source_refused');
    expect(budget.current()).toBe(5);
    unwrap(await bus.undo(null, UI));
    expect(budget.current()).toBe(2);
    const agentRedo = await bus.redo(null, { source: 'agent', actor: 'agent:r1' });
    expect(!agentRedo.ok && agentRedo.error.code).toBe('core.command_source_refused');
    unwrap(await bus.redo(null, UI));
    expect(budget.current()).toBe(5);
  });

  it('treats an empty source list as a wiring bug', () => {
    const spec = {
      name: 'x.y',
      payload: z.object({}),
      sideEffect: 'write' as const,
      handle: () => ok({ result: 1 }),
    };
    expect(() => defineCommand({ ...spec, sources: [] })).toThrow(/accepts no source/);
    expect(defineCommand(spec).sources).toBeUndefined();
    expect(defineCommand({ ...spec, sources: PERSON_SOURCES }).sources).toEqual(['ui', 'shortcut']);
  });
});
