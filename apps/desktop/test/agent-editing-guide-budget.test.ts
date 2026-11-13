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
  projectId: '01000000000000000000000001',
  timelineId: '01000000000000000000000002',
  templateId: '01000000000000000000000003',
  renderId: '01000000000000000000000004',
};
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const given = (id: string) =>
  id === 'agent.gaps'
    ? { projectId: ids.projectId, timelineIds: [ids.timelineId], gaps: [] }
    : {
        projectId: ids.projectId,
        timelineId: ids.timelineId,
        ...(id === 'render.reviewer'
          ? { version: 1 }
          : id === 'timeline.maker'
            ? { templateId: ids.templateId }
            : { request: 'Follow my requested edit, preserving the locked clip and my own text.' }),
      };
it.each([
  { role: 'timeline.editor', tool: 'timeline.setCover', topic: 'taalcut/edit-cover' },
  { role: 'timeline.editor', tool: 'workspace.place', topic: 'taalcut/edit-graphics' },
  { role: 'timeline.maker', tool: 'timeline.editText', topic: 'taalcut/edit-text' },
])(
  'reads real guide data and timeline evidence before $tool, then hands off',
  async ({ role, tool: selected, topic }) => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    try {
      const tools = root.container.resolve(ToolRegistryToken);
      const live = root.container.resolve(SkillRegistryToken);
      const skill: AnySkill = {
        ...live.get(role)!,
        verify: async () => ok({ verdict: 'pass' as const }),
        card: undefined,
      };
      const skills = unwrap(
        createSkillRegistry([defineSkillModule({ id: role.split('.')[0]!, skills: [skill] })], tools),
      );
      const itemId = '01000000000000000000000005';
      const clips = Array.from({ length: 13 }, (_, i) => ({
        clip: i + 1,
        clipId: `010000000000000000000000${String(i + 10).padStart(2, '0')}`,
        kind: 'clip',
        locked: i === 0,
        userPick: i === 0,
        at: i * 2,
        seconds: 2,
        shows: `${i + 1}: The creator walks through the courtyard; preserve the selected footage and timing.`,
      }));
      const timeline = (revision: number) => ({
        id: ids.timelineId,
        projectId: ids.projectId,
        name: 'Courtyard reel',
        revision,
        rate: { num: 30, den: 1 },
        frames: 780,
        clips,
        texts: [{ itemId, text: 'My own words', origin: 'user', start: 0, frames: 60 }],
      });
      expect(tools.resolve('timeline.get')!.spec.output.safeParse(timeline(1)).success).toBe(true);
      let revision = 1;
      let stepTurn = 0;
      let edits = 0;
      const pending = 'The cover design is prepared; its JPEG export is still pending.';
      const models = createScriptedModelClient((request, turn) => {
        if (!request.system?.includes(`# Skill: ${role}`))
          return turn === 0
            ? {
                toolCalls: [
                  call('updatePlan', {
                    steps: [
                      {
                        text: 'Read the timeline and relevant guide, apply the requested change, then verify.',
                        skill: role,
                        input: given(role),
                      },
                    ],
                  }),
                ],
              }
            : { text: 'The fixture is complete.' };
        const at = stepTurn++;
        const offered = request.tools?.map((t) => t.name) ?? [];
        const text = JSON.stringify(request.messages);
        const get = () => ({ toolCalls: [call('timeline_get', { timelineId: ids.timelineId })] });
        if (at === 0) {
          expect(offered).toContain('timeline_get');
          return get();
        }
        const last = (name: string) => {
          const message = request.messages.findLast((m) => m.role === 'tool' && m.toolName === name);
          return String(message?.role === 'tool' ? message.content : '');
        };
        if (at === 1) {
          expect(last('timeline_get')).not.toContain('Stored as result');
          const observed = JSON.parse(last('timeline_get').split('\n\n')[0]!);
          expect(observed.revision).toBe(1);
          expect(observed.clips[0]).toMatchObject({ clipId: clips[0]!.clipId, locked: true });
          expect(observed.texts[0]).toMatchObject({ itemId, origin: 'user' });
          return {
            // The selected action needs the revision and preservation rules; unrelated item ids remain
            // in the exact timeline result and are not repeated as invented creator-facing technical prose.
            text: `Observed current revision ${observed.revision}; preserve the locked first clip and all user text.`,
            toolCalls: [call('findTools', { query: 'workspace.docs' })],
          };
        }
        if (at === 2) {
          expect(offered).toContain('workspace_docs');
          return { toolCalls: [call('workspace_docs', { topic, page: 1 })] };
        }
        if (at === 3) {
          expect(last('workspace_docs')).not.toContain('Stored as result');
          expect(last('workspace_docs')).toContain('hyperframes-docs');
          expect(last('workspace_docs')).toContain(topic);
          expect(last('workspace_docs')).toContain(
            selected === 'timeline.setCover' ? 'timeline.setCover' : 'itemIds',
          );
          return {
            text: `Read ${topic}: keep existing item ids, preserve footage and user words, use current revision 1.`,
            toolCalls: [call('findTools', { query: selected })],
          };
        }
        if (at === 4) {
          expect(offered).toContain(tools.resolve(selected)!.descriptor.callName);
          expect(text).toContain('current revision 1');
          expect(text).toContain('preserve footage and user words');
          const base = { projectId: ids.projectId, timelineId: ids.timelineId, revision: 1 };
          const args =
            selected === 'timeline.setCover'
              ? {
                  ...base,
                  cover: { aspect: '16:9', source: { kind: 'frame', frame: 0 }, hookText: 'Courtyard' },
                }
              : selected === 'workspace.place'
                ? {
                    ...base,
                    entry: 'intro.html',
                    name: 'Courtyard',
                    request: 'Add the requested courtyard label.',
                    at: 0,
                  }
                : { ...base, text: 'Courtyard', atSeconds: 2, durationSeconds: 2 };
          return { toolCalls: [call(tools.resolve(selected)!.descriptor.callName, args)] };
        }
        if (at === 5) return { toolCalls: [call('findTools', { query: 'timeline.get' })] };
        if (at === 6) return get();
        if (at === 7 && last('timeline_get').startsWith('Stored as result')) {
          const id = /^Stored as result (\S+)/.exec(last('timeline_get'))![1]!;
          return { toolCalls: [call('readArtifact', { id, path: '/revision' })] };
        }
        if (at === 8) expect(last('readArtifact')).toContain('\n2\n</untrusted>');
        else expect(last('timeline_get')).toMatch(/"revision":\s*2/);
        expect(text).toMatch(/revision/);
        return {
          text:
            selected === 'timeline.setCover'
              ? pending
              : 'Applied the requested change and checked the current timeline.',
          toolCalls: [
            call('handOff', {
              timelineId: ids.timelineId,
              revision: 2,
              ...(selected === 'timeline.setCover' ? { notSavedCoverReason: pending } : {}),
            }),
          ],
        };
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
        executor: {
          async execute(name, args, options) {
            const tool = tools.resolve(name)!;
            const parsed = tool.spec.input.safeParse(args);
            expect(parsed.success, name).toBe(true);
            let value: unknown;
            if (tool.descriptor.name === 'workspace.docs')
              value = unwrap(await tool.spec.run(parsed.success ? parsed.data : {}, {} as never));
            else if (tool.descriptor.name === 'timeline.get') value = timeline(revision);
            else {
              expect(tool.descriptor.name).toBe(selected);
              edits++;
              revision = 2;
              value =
                selected === 'workspace.place'
                  ? {
                      projectId: ids.projectId,
                      timelineId: ids.timelineId,
                      itemIds: [newId<'TimelineItem'>()],
                      revision,
                      compositionId: newId<'GraphicComposition'>(),
                      version: 1,
                      name: 'Courtyard',
                      start: { value: 0, rate: { num: 30, den: 1 } },
                      duration: { value: 60, rate: { num: 30, den: 1 } },
                      unmatched: [],
                      note: 'Proposed; the creator can choose Use it.',
                    }
                  : { timelineId: ids.timelineId, revision, affectedItemIds: [] };
            }
            expect(tool.spec.output.safeParse(value).success, name).toBe(true);
            return ok({
              tool: tool.descriptor.name,
              value,
              callId: options!.callId!,
              version: tool.descriptor.version,
              inputHash: 'fixture',
              output: { kind: 'inline' as const, value },
              cached: false,
              deduplicated: false,
              attempts: 1,
              durationMs: 0,
              usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
            });
          },
        },
      });
      const result = unwrap(
        await agent.run({
          conversationId: `guide-${selected}`,
          projectId: ids.projectId,
          message:
            'Use my courtyard timeline. Preserve my locked first clip and my own text. Read the relevant guide before applying only my requested design change. Keep every shot separately editable.',
        }),
      );
      const events = unwrap(await log.read(result.runId));

      expect(
        result.status,
        JSON.stringify(
          events.filter((e) => e.type === 'run.failed' || e.type === 'context.compacted').slice(-2),
        ),
      ).toBe('completed');
      expect(edits).toBe(1);

      expect(events.filter((e) => e.type === 'tool.failed')).toEqual([]);
      expect(events.some((e) => e.type === 'verify.result' && e.payload.verdict === 'pass')).toBe(true);
      for (const e of events)
        if (e.type === 'context.compacted') {
          expect(e.payload.fits).toBe(true);
          expect(e.payload.afterTokens).toBeLessThanOrEqual(6963);
        }
      expect(unwrap(await agent.replay(result.runId)).promptDrift).toBe(0);
    } finally {
      await root.container.dispose();
    }
  },
  30_000,
);
