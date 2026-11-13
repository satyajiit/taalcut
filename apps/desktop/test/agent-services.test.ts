// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent package's Phase 2 services in the agent root: the skills of
 * every flow are composed over the domain packages' tools (P2-M13: the make
 * flow is live), Local only is read before any model call and
 * again after privacy.setLocalOnly, the budget, privacy, onboarding,
 * telemetry and debug-bundle namespaces are served, and every command
 * reaches the flow watcher.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { connectRpc, OPENING_PATHS, serveRpc, TelemetryToken, UTILITY_CONTRACTS } from '@taalcut/core';
import { flowProblems } from '@taalcut/agent';
import { ToolRegistryToken } from '../src/shared/tokens';
import { LocalOnlyFlagToken, SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { AgentToken } from '../src/utility/roots/agent-loop';
import { startAgentServices } from '../src/utility/roots/agent-services';
import { TelemetryServiceToken } from '../src/utility/roots/telemetry';
import type { UtilityRoot } from '../src/utility/runtime';
import { testAgent, testConfig } from './helpers/roots';

function serve(root: UtilityRoot): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return port2;
}

describe("the agent's Phase 2 services", () => {
  it('composes the skills of every flow, and reads Local only before any call', async () => {
    const root = testAgent(testConfig('agent'));
    const skills = root.container.resolve(SkillRegistryToken);
    const tools = root.container.resolve(ToolRegistryToken);
    // agent.gaps (P3-B8) joins once the timeline store is registered: the step after the Librarian. The Voice
    // director (P3-B6) joins with the library's generated-asset sink. The Designer (HFW1) with the workspace and
    // comment stores.
    expect(
      skills
        .list()
        .map((skill) => skill.id)
        .sort(),
    ).toEqual([
      'agent.brief',
      'agent.gaps',
      'render.designer',
      'render.reviewer',
      'templates.analyst',
      'timeline.editor',
      'timeline.librarian',
      // AGT2: the Maker makes the video in the flows.
      'timeline.maker',
      'voice.director',
    ]);
    const hasTool = (name: string) => tools.describe(name) !== undefined;
    // What the library's Phase 3 stores switch on (library-phase3.ts): a look from Styles, stills it can keep.
    for (const name of ['vision.matchLook', 'images.generateForSlot', 'hub.search'])
      expect(hasTool(name), name).toBe(true);
    for (const path of OPENING_PATHS) expect(flowProblems(path, skills, hasTool), path).toEqual([]);
    const flag = root.container.resolve(LocalOnlyFlagToken);
    expect(flag.get()).toBe(true);
    await startAgentServices(root.container);
    expect(flag.get()).toBe(false);

    const client = connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;
    await client.commands.dispatch({ name: 'privacy.setLocalOnly', payload: { enabled: true } });
    await vi.waitFor(() => expect(flag.get()).toBe(true));
    expect(await client.privacy.overview()).toMatchObject({ localOnly: true });
    await root.container.dispose();
  });

  it('serves budget, onboarding, telemetry and debug bundles, and every command reaches the flow watcher', async () => {
    const root = testAgent(testConfig('agent'));
    await startAgentServices(root.container);
    const agent = root.container.resolve(AgentToken);
    const noted = vi.spyOn(agent, 'noteCommand');
    const client = connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;

    expect(await client.budget.defaults()).toEqual({ projectCap: { currency: 'USD', micros: 2_000_000 } });
    const created = (await client.commands.dispatch({
      name: 'project.create',
      payload: { name: 'Goa' },
    })) as {
      result: { projectId: string };
    };
    const projectId = created.result.projectId as never;
    expect(await client.budget.project({ projectId })).toMatchObject({
      cap: { currency: 'USD', micros: 2_000_000 },
    });
    await client.commands.dispatch({
      name: 'project.setBudgetCap',
      payload: { projectId, cap: { currency: 'USD', micros: 5_000_000 } },
    });
    expect(await client.budget.project({ projectId })).toMatchObject({ cap: { micros: 5_000_000 } });
    expect(noted).toHaveBeenCalledWith(expect.objectContaining({ projectId, source: 'ui' }));

    expect(await client.onboarding.state()).toBeDefined();
    expect(root.container.resolve(TelemetryToken)).toBe(root.container.resolve(TelemetryServiceToken));
    expect(await client.telemetry.state()).toMatchObject({ enabled: false, queued: 0 });
    const sections = await client.debugBundle.collect({});
    expect(sections.map((s) => s.section)).toEqual(expect.arrayContaining(['settings']));
    expect(JSON.stringify(sections)).not.toContain(testConfig('agent').userData);
    await root.container.dispose();
  });
});
