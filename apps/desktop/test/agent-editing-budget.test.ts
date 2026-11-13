// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Every supported editing role can discover its real schemas at the shipped local context size. */
import { afterEach, expect, it } from 'vitest';
import { defineSkillModule, newId, ok, unwrap, type AnySkill } from '@taalcut/core';
import {
  createAgent,
  createMemoryEventLogStore,
  createScriptedModelClient,
  createSkillRegistry,
  parseSoul,
} from '@taalcut/agent';
import { ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { SOUL, testAgent, testConfig } from './helpers/roots';

afterEach(closeAllPorts);
const ids = {
  projectId: newId<'Project'>(),
  timelineId: newId<'Timeline'>(),
  templateId: newId<'Template'>(),
  renderId: newId<'Render'>(),
};
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const given = (id: string) => {
  const base = { projectId: ids.projectId, timelineId: ids.timelineId };
  if (id === 'agent.gaps') return { projectId: ids.projectId, timelineIds: [ids.timelineId], gaps: [] };
  if (id === 'agent.brief') return { projectId: ids.projectId };
  if (id === 'templates.analyst')
    return { projectId: ids.projectId, reference: { kind: 'file', path: '/fixture/reference.mp4' } };
  if (id === 'timeline.librarian') return { projectId: ids.projectId, templateId: ids.templateId };
  if (id === 'render.designer')
    return {
      ...base,
      jobs: [{ jobId: 'courtyard', request: 'Design the requested courtyard title.', at: 0 }],
    };
  return {
    ...base,
    ...(id === 'render.reviewer'
      ? { version: 1 }
      : id === 'timeline.maker'
        ? { templateId: ids.templateId }
        : { request: 'Follow my requested edit, preserving the locked clip and my own text.' }),
  };
};
const handoff = (id: string) => {
  const base = { timelineId: ids.timelineId, revision: 1 };
  if (id === 'agent.gaps') return { gaps: [], filming: 0, timelines: [base] };
  if (id === 'agent.brief') return { text: 'A courtyard walk from the selected footage.' };
  if (id === 'templates.analyst')
    return {
      templateId: ids.templateId,
      version: 1,
      slotCount: 13,
      breakdownId: newId<'Experiment'>(),
      unconfirmedCuts: [],
    };
  if (id === 'timeline.librarian')
    return {
      templateId: ids.templateId,
      timelineIds: [ids.timelineId],
      revisions: [1],
      lowConfidenceSlots: 0,
      reranked: 0,
    };
  if (id === 'render.designer')
    return {
      ...base,
      results: [
        {
          jobId: 'courtyard',
          outcome: 'notDone',
          reason: 'This schema-only fixture does not author a composition.',
        },
      ],
    };
  if (id === 'render.reviewer')
    return { renderId: ids.renderId, timelineVersion: 1, passed: true, fixes: [] };
  return base;
};

it.each([
  'timeline.maker',
  'timeline.editor',
  'render.reviewer',
  'agent.gaps',
  'agent.brief',
  'templates.analyst',
  'timeline.librarian',
  'render.designer',
])(
  'fits every actual permitted schema and a control exit for %s',
  async (id) => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    try {
      const tools = root.container.resolve(ToolRegistryToken);
      const live = root.container.resolve(SkillRegistryToken);
      const skill: AnySkill = {
        ...live.get(id)!,
        verify: async () => ok({ verdict: 'pass' as const }),
        card: undefined,
      };
      expect(skill.input.safeParse(given(id)).success).toBe(true);
      expect(skill.output.safeParse(handoff(id)).success).toBe(true);
      const skills = unwrap(
        createSkillRegistry([defineSkillModule({ id: id.split('.')[0]!, skills: [skill] })], tools),
      );
      const withheld = new Set(skill.withheldTools?.(skill.input.parse(given(id))) ?? []);
      for (const name of skills.subset(skill).filter((name) => !withheld.has(name))) {
        let stepTurn = 0;
        let offered = false;
        const models = createScriptedModelClient((request, turn) => {
          if (!request.system?.includes(`# Skill: ${id}`))
            return turn === 0
              ? {
                  toolCalls: [
                    call('updatePlan', {
                      steps: [
                        { text: `Review the given timeline using ${id}.`, skill: id, input: given(id) },
                      ],
                    }),
                  ],
                }
              : { text: 'The schema check is complete.' };
          switch (stepTurn++) {
            case 0:
              return { toolCalls: [call('findTools', { query: name })] };
            case 1:
              expect(
                request.tools?.map((t) => t.name),
                `${id}: ${name}`,
              ).toContain(tools.resolve(name)!.descriptor.callName);
              offered = true;
              return { toolCalls: [call('findTools', { query: 'handOff' })] };
            default:
              expect(
                request.tools?.map((t) => t.name),
                `${id}: ${name} exit`,
              ).toContain('handOff');
              return { toolCalls: [call('handOff', handoff(id))] };
          }
        });
        const log = createMemoryEventLogStore();
        const agent = createAgent({
          models,
          tools,
          skills,
          log,
          soul: parseSoul(SOUL),
          contextWindow: () => 12_288,
          settings: { autonomy: 'autopilot', localOnly: true, budget: {} },
        });
        const result = unwrap(
          await agent.run({
            conversationId: `matrix-${id}-${name}`,
            projectId: ids.projectId,
            message:
              'Use the current timeline revision. Preserve the clip I locked and the words I wrote. Follow only the requested change; the project and footage are already selected.',
          }),
        );
        expect(result.status, `${id}: ${name}`).toBe('completed');
        expect(offered, `${id}: ${name}`).toBe(true);
        const events = unwrap(await log.read(result.runId));
        expect(
          events.filter((e) => e.type === 'tool.failed'),
          `${id}: ${name}`,
        ).toEqual([]);
        for (const event of events)
          if (event.type === 'context.compacted') {
            expect(event.payload.fits, `${id}: ${name}`).toBe(true);
            expect(event.payload.budgetTokens).toBe(6963);
            expect(event.payload.afterTokens).toBeLessThanOrEqual(6963);
          }
      }
    } finally {
      await root.container.dispose();
    }
  },
  60_000,
);
