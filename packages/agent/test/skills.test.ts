// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T5 machinery (SPEC sections 11 and 18): a skill added in a domain
 * module runs with no agent change. It is catalogued, entered with its typed
 * input, limited to its own tools, its handOff validated, checked by its
 * second method (pass, retry, fail), its card sent under the step's id and
 * again when what it made changes, and replay gives the same run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { createSkillRegistry, SKILL_INPUT_NOTE, type ScriptedReply } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, registryFor, turns, types } from './support/harness';
import {
  createThings,
  otherTools,
  testdomainSkills,
  testdomainTools,
  type Things,
} from './support/testdomain-module';

const projectId = newId<'Project'>();
const ask = { conversationId: 'c', projectId, message: 'Make me a round thing.' };
const planSkill = (input: Record<string, unknown> = { shape: 'round' }): ScriptedReply => ({
  toolCalls: [call('updatePlan', { steps: [{ text: 'Make the thing', skill: 'testdomain.maker', input }] })],
});
const make = { toolCalls: [call('testdomain_makeThing', { shape: 'round' })] };

function setup(things: Things, replies: ScriptedReply[], extra = {}) {
  const modules = [testdomainTools(things), otherTools()];
  const skills = unwrap(createSkillRegistry([testdomainSkills(things)], registryFor(modules)));
  let handed = 0;
  // The handoff names the newest thing the model made (read back from the tool result).
  const script = turns(...replies);
  return harness({
    script: (request, turn) => {
      const reply = script(request, turn);
      if (reply.toolCalls?.[0]?.name !== 'handOff') return reply;
      handed += 1;
      const [thingId, version] = [...things.versions.entries()].at(-1) ?? ['', 0];
      return {
        toolCalls: [
          call('handOff', { thingId, version, ...(handed === 1 ? reply.toolCalls[0].arguments : {}) }),
        ],
      };
    },
    modules,
    deps: { skills, ...extra },
  });
}

describe('a skill added in a domain module runs with no agent change', () => {
  it('is catalogued, entered with its input, sees only its tools and hands off a typed result', async () => {
    const things = createThings();
    const h = setup(things, [planSkill(), make, { toolCalls: [call('handOff', {})] }, { text: 'Made it.' }]);
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome.status).toBe('completed');
    const [plan, act] = h.models.requests;
    expect(plan?.system).toContain('skill: testdomain.maker: Makes a thing of the given shape');
    expect(act?.system).toContain('# Skill: testdomain.maker');
    expect(act?.system).toContain('testdomain: testdomain.makeThing:');
    expect(act?.system).not.toContain('other.peek');
    expect(act?.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['handOff', 'testdomain_makeThing']),
    );
    expect(act?.tools?.map((t) => t.name)).not.toContain('other_peek');
    expect(act?.messages.at(-1)).toEqual({
      role: 'user',
      content: `[Taalcut] ${SKILL_INPUT_NOTE} {"shape":"round"}`,
    });
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'skill.entered')[0]?.payload).toMatchObject({
      skill: 'testdomain.maker',
      version: '2.1.0',
      input: { shape: 'round' },
    });
    const handed = ofType(events, 'skill.handedOff')[0]?.payload;
    expect(handed).toMatchObject({ skill: 'testdomain.maker', refs: [{ entity: 'template', version: 1 }] });
    expect(handed?.output).toEqual({ thingId: [...things.versions.keys()][0], version: 1 });
    expect(types(events)).toEqual(
      expect.arrayContaining(['skill.verified', 'skill.handedOff', 'checkpoint.saved']),
    );
    // Its card goes out under the step's id, not the domain's own.
    const card = ofType(events, 'card.sent')[0]?.payload.card;
    expect(card).toMatchObject({
      type: 'progress',
      id: expect.stringMatching(/^step:.+:testdomain\.maker$/),
    });
  });

  it('refuses a tool outside the subset and a handoff that does not fit; the model fixes both', async () => {
    const things = createThings();
    const h = setup(things, [
      planSkill(),
      { toolCalls: [call('findTools', { query: 'peek at something unrelated' })] },
      { toolCalls: [call('other_peek', {})] },
      { toolCalls: [call('handOff', { thingId: 'not-an-id', version: 0 })] },
      { text: 'Done, I think.' },
      make,
      { toolCalls: [call('handOff', {})] },
      { text: 'Made it.' },
    ]);
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.completed')[1]?.payload.loaded ?? []).not.toContain('other.peek');
    const failures = ofType(events, 'tool.failed').map((e) => e.payload.error.code);
    expect(failures).toEqual(['agent.outside_skill', 'tools.invalid_input']);
    // A turn without a handoff doesn't end the step: the skill is told to hand off.
    expect(JSON.stringify(h.models.requests[5]?.messages)).toContain('Hand off with handOff.');
  });

  it('a failed check goes back as a note and the next handoff passes; a hard fail ends the run', async () => {
    const retry = createThings([{ verdict: 'retry', reason: 'The thing is lopsided.' }]);
    const h = setup(retry, [
      planSkill(),
      make,
      { toolCalls: [call('handOff', {})] },
      make,
      { toolCalls: [call('handOff', {})] },
      { text: 'ok' },
    ]);
    const done = unwrap(await h.agent.run(ask));
    expect(done.status).toBe('completed');
    const events = await h.events(done.runId);
    expect(ofType(events, 'skill.verified').map((e) => e.payload.verdict)).toEqual(['retry', 'pass']);
    expect(JSON.stringify(h.models.requests.at(-2)?.messages)).toContain(
      'Check failed: The thing is lopsided.',
    );

    const fail = createThings([{ verdict: 'fail', reason: 'Not a thing at all.' }]);
    const f = setup(fail, [planSkill(), make, { toolCalls: [call('handOff', {})] }]);
    const failed = unwrap(await f.agent.run(ask));
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'agent.verify_failed', detail: 'Not a thing at all.' },
    });
  });

  it('a skill input that does not fit fails the step with agent.skill_input_invalid', async () => {
    const h = setup(createThings(), [planSkill({ shape: 'triangle' })]);
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'agent.skill_input_invalid' } });
  });

  it('a finished run is not watched; replay gives the same calls', async () => {
    const things = createThings();
    const refs = {
      version: async (ref: { id: string }) => ({ ok: true as const, value: things.versions.get(ref.id) }),
    };
    const h = setup(things, [planSkill(), make, { toolCalls: [call('handOff', {})] }, { text: 'Made it.' }], {
      refs,
    });
    const outcome = unwrap(await h.agent.run(ask));
    const thingId = [...things.versions.keys()][0]!;
    things.versions.set(thingId, 2);
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId, source: 'ui' });
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId: newId<'Project'>(), source: 'ui' });
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId, source: 'agent' });
    const events = await h.events(outcome.runId);
    // The run had ended: a finished run is not watched.
    expect(ofType(events, 'flow.inputChanged')).toHaveLength(0);
    const report = unwrap(await h.agent.replay(outcome.runId));
    expect(report.toolCalls.map((c) => c.tool)).toEqual(['testdomain.makeThing']);
    expect(report.status).toBe('completed');
  });

  it('the registry refuses a bad module with every problem, and the agent source never names the skill', () => {
    const things = createThings();
    const registry = registryFor([testdomainTools(things)]);
    const bad = createSkillRegistry(
      [testdomainSkills(things), testdomainSkills(things), { id: 'Bad', skills: [] }],
      registry,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('agent.skill_invalid');
      expect(bad.error.detail).toContain("module 'testdomain': registered twice");
      expect(bad.error.detail).toContain('lowercase letters and digits');
    }
    const missing = createSkillRegistry([testdomainSkills(things)], registryFor([otherTools()]));
    expect(!missing.ok && missing.error.detail).toContain("no registered tool is in family 'testdomain'");
    const src = join(import.meta.dirname, '..', 'src');
    // Every source file, in the feature folders too.
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      expect(readFileSync(join(src, file), 'utf8'), file).not.toMatch(/testdomain/);
    }
  });
});
