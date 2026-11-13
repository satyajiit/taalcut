// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-STY in the agent root: appContract.templates serves a set's style profile over the library, its summary
 * says honestly that no model could write it (the test agent has no local runtime and no cloud consent), the style
 * tools are offered to the agent, and `styleProfile.use` records a project's style (undoable) that the render
 * process reads as the band QA's stylePacing checks.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { connectRpc, serveRpc, unwrap, UTILITY_CONTRACTS, type ProjectId } from '@taalcut/core';
import { createRepositories, createTemplateStore, openDatabase } from '@taalcut/library';
import { syntheticTemplate } from '@taalcut/templates';
import { ToolRegistryToken } from '../src/shared/tokens';
import { StyleProfilesToken } from '../src/utility/roots/agent-style-profiles';
import { renderStylePacing } from '../src/utility/roots/render-style-pacing';
import type { UtilityRoot } from '../src/utility/runtime';
import { testAgent, testConfig } from './helpers/roots';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const TRAVEL = { kind: 'tag', tag: 'travel' } as const;

/** A migrated library with three templates tagged "travel" (1 s shots and so on) and a project. */
async function library(): Promise<{ dbPath: string; projectId: ProjectId }> {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-style-'));
  dirs.push(dir);
  const dbPath = join(dir, 'library.sqlite');
  const db = unwrap(openDatabase({ path: dbPath }));
  const templates = createTemplateStore(db, { assetsDir: join(dir, 'assets') });
  const specs = [
    { index: 1, shots: [15, 30, 30, 45] },
    { index: 2, shots: [30, 24, 36] },
    { index: 3, shots: [30, 30, 30, 30] },
  ];
  for (const spec of specs)
    unwrap(
      await templates.create(syntheticTemplate(spec), {
        name: `Travel ${spec.index}`,
        projectId: null,
        listed: true,
      }),
    );
  db.driver.prepare(`UPDATE templates SET tags = '["travel"]'`).run();
  const project = unwrap(createRepositories(db).projects.create({ name: 'Goa' }));
  db.close();
  return { dbPath, projectId: project.id };
}

function client(root: UtilityRoot) {
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return connectRpc(UTILITY_CONTRACTS.agent, port2, { peer: 'agent' }).client;
}

describe('style profiles in the agent root (LRN1-STY)', () => {
  it("serves a set's profile with an honest summary, offers the tools, and records a project's style", async () => {
    const { dbPath, projectId } = await library();
    const root = testAgent(testConfig('agent', dbPath));
    const agent = client(root);

    const view = await agent.templates.styleProfile({ source: TRAVEL });
    expect(view).toMatchObject({ source: TRAVEL, name: 'travel', profile: { members: 3 } });
    expect(view.profile?.pacing.shot).toMatchObject({ n: 11, median: 1 });
    await root.container.resolve(StyleProfilesToken).settled();
    const after = await agent.templates.styleProfile({ source: TRAVEL });
    expect(after.summary).toMatchObject({ state: 'none', reason: 'no_model' });

    const tools = root.container.resolve(ToolRegistryToken);
    expect(tools.describe('templates.styleProfile')).toMatchObject({ sideEffect: 'read' });
    expect(tools.describe('templates.useStyleProfile')).toMatchObject({ sideEffect: 'write' });

    const pacing = renderStylePacing(root.container).stylePacing;
    expect(await pacing?.(projectId)).toEqual({ ok: true, value: null });
    await agent.commands.dispatch({ name: 'styleProfile.use', payload: { projectId, source: TRAVEL } });
    expect(await pacing?.(projectId)).toEqual({ ok: true, value: view.profile?.pacing.shot });
    await agent.commands.undo({ projectId });
    expect(await pacing?.(projectId)).toEqual({ ok: true, value: null });
    await root.container.dispose();
  });
});
