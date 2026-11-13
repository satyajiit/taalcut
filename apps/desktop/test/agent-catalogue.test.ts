// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-FIX: the agent process offers its model exactly the tool catalogue each recorded session it replays was made
 * with (apps/gate-demo fixtures/<session>.catalogue.txt), so the e2e journeys that replay them (e2e/gate.e2e.ts, the
 * make flow's) get the requests the cassettes hold. Tool search and a skill's route rank over the whole catalogue: the
 * plugins module, added here and not in the demo, made the gate journey's first answer "Something went wrong", and
 * the style tools, added after the make flow was recorded, left its journeys waiting on a cassette miss. With main
 * connected, as in the app, so the plugins module is offered. Recording a session in the app writes its file
 * (agent-recorded-models.ts).
 *
 * EAR1-I1: and each skill step those journeys recorded is offered what its skill offers now (@taalcut/gate-demo
 * skill-steps.ts). The catalogue doesn't show a skill's own list: the Editor's plugin tools (P3-PLG1) and its
 * listening tools (EAR1-A3) changed every Editor request while every catalogue line held. With
 * TAALCUT_REFRESH_OFFERS=<dir> it writes those offers there instead (<session>.offers.json, by request), for
 * apps/gate-demo's scripts/refresh-catalogue.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  catalogueDrift,
  catalogueOf,
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  MAKE_FLOW_SESSION,
  recordedCatalogue,
  recordedSkillSteps,
  skillStepOffer,
  type RecordedSkillStep,
} from '@taalcut/gate-demo';
import { disableNetwork } from '@taalcut/models';
import { ToolModulesToken, ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

afterEach(() => {
  closeAllPorts();
  vi.unstubAllEnvs();
});

it.each([GATE_DEMO_SESSION, MAKE_FLOW_SESSION, EDIT_CHAT_SESSION, EDIT_DESIGN_SESSION])(
  'offers the agent the tools the $name session was recorded with, in the same order',
  async (session) => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    const offered = catalogueOf(root.container.resolve(ToolModulesToken));
    await root.container.dispose();
    expect(
      catalogueDrift(recordedCatalogue(session) ?? [], offered),
      `the ${session.name} session was recorded with other tools: with the same modules, in this order, in ` +
        `apps/gate-demo/test/compose*.ts, re-record it (${session.rerecord})`,
    ).toEqual([]);
  },
);

/** What each recorded skill step's skill offers now (call names), from this process composed as the app's journeys run. */
async function offersNow(steps: readonly RecordedSkillStep[]): Promise<string[][]> {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  try {
    const skills = root.container.resolve(SkillRegistryToken);
    const tools = root.container.resolve(ToolRegistryToken);
    return steps.map((step) => {
      const skill = skills.get(step.skill);
      if (!skill) return [];
      const offer = skillStepOffer(skills, skill, step.input);
      return offer.map((name) => tools.resolve(name)?.descriptor.callName ?? name);
    });
  } finally {
    await root.container.dispose();
  }
}

// The gate demo's session has no skill step: its plain steps are re-derived by its own headless journey.
it.each([MAKE_FLOW_SESSION, EDIT_CHAT_SESSION, EDIT_DESIGN_SESSION])(
  'offers each skill step of the $name session the tools its skill offers now',
  async (session) => {
    // As the app's journeys record and replay it (e2e/make-flow-support.ts); offline, as the refresh must be.
    vi.stubEnv('TAALCUT_TEST_RECORDED_MODELS', GATE_DEMO_FIXTURES);
    const steps = recordedSkillSteps(session);
    const guard = disableNetwork();
    const now = await offersNow(steps).finally(() => guard.restore());
    expect(guard.blocked).toEqual([]);
    const out = process.env.TAALCUT_REFRESH_OFFERS;
    if (out) {
      mkdirSync(out, { recursive: true });
      const offers = Object.fromEntries(
        steps.map((step, i) => [step.index, { skill: step.skill, tools: now[i] }]),
      );
      writeFileSync(join(out, `${session.name}.offers.json`), `${JSON.stringify(offers, null, 2)}\n`);
      return;
    }
    const drift = steps.flatMap((step, i) => {
      const want = now[i] ?? [];
      if (want.join() === step.offered.join()) return [];
      const added = want.filter((name) => !step.offered.includes(name));
      const dropped = step.offered.filter((name) => !want.includes(name));
      return [`#${step.index} ${step.skill}: + ${added.join(' ')}; - ${dropped.join(' ')}`];
    });
    expect(
      drift,
      `the ${session.name} session's skill steps were recorded with other tools: refresh it offline with ` +
        '`pnpm --filter @taalcut/gate-demo refresh:catalogue` (apps/gate-demo/scripts/refresh-catalogue.ts)',
    ).toEqual([]);
  },
);
