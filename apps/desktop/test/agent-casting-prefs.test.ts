// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-PREF in the agent root, over a real library database: a person's swaps in the command audit log become a
 * learned user-scope memory item written through the memory commands (undoable, audited), casting's config source
 * reads it, and deleting it (Settings' Reset) puts casting back on its defaults.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connectRpc, serveRpc, TIMELINE_COMMANDS, unwrap, UTILITY_CONTRACTS } from '@taalcut/core';
import { createRepositories, openDatabase } from '@taalcut/library';
import { CASTING_CONFIG } from '@taalcut/timeline';
import { personSwapEntry } from '@taalcut/timeline/test-support';
import {
  CastingConfigSourceToken,
  librarySignalLog,
  startCastingPrefs,
} from '../src/utility/roots/agent-casting-prefs';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

const dir = mkdtempSync(join(tmpdir(), 'taalcut-prefs-'));
afterAll(() => {
  closeAllPorts();
  rmSync(dir, { recursive: true, force: true });
});

describe('learned casting preferences in the agent root (LRN1-PREF)', () => {
  it('learns from the log into one memory item, casting reads it, and Reset gives the defaults back', async () => {
    // A project and the person's swaps, in the library's log as main's bus wrote them.
    const dbPath = join(dir, 'library.sqlite');
    const library = unwrap(openDatabase({ path: dbPath }));
    const repositories = createRepositories(library);
    const project = unwrap(repositories.projects.create({ name: 'Goa' }));
    for (let index = 0; index < 12; index++)
      unwrap(repositories.auditLog.append(personSwapEntry(project.id, Date.now() + index)));
    const read = await librarySignalLog(library).entries([TIMELINE_COMMANDS.swapClip]);
    expect(read.ok && read.value).toHaveLength(12);
    library.close();

    // The agent process on that library, its router served to main as the app serves it.
    const root = testAgent(testConfig('agent', dbPath));
    const { local, remote } = nodeChannel();
    serveRpc(root.router, local, { context: { caller: 'main' } });
    const client = connectRpc(UTILITY_CONTRACTS.agent, remote, { peer: 'agent' }).client;

    await startCastingPrefs(root.container);
    const listed = await client.memory.list({ scope: 'user' });
    expect(listed.items).toHaveLength(1);
    const [item] = listed.items;
    if (!item) throw new Error('nothing learned');
    expect(item).toMatchObject({
      source: 'learned',
      data: { kind: 'casting-weights', configVersion: CASTING_CONFIG.version },
    });
    expect(item.text).toMatch(/^Leans toward shots whose camera motion matches the template/);

    const source = root.container.resolve(CastingConfigSourceToken);
    const learned = await source.resolve();
    if (!learned.ok) throw new Error(learned.error.code);
    expect(learned.value.weights).toMatchObject({ source: 'learned', memoryId: item.id });
    expect(learned.value.config.weights.motion).toBeGreaterThan(CASTING_CONFIG.weights.motion);

    await client.commands.dispatch({ name: 'memory.delete', payload: { memoryId: item.id } });
    const reset = await source.resolve();
    expect(reset.ok && reset.value).toMatchObject({
      label: CASTING_CONFIG.version,
      weights: { source: 'default' },
    });
    await root.container.dispose();
  });
});
