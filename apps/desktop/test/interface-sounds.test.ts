// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectRpc, serveRpc, SETTINGS_COMMANDS, UTILITY_CONTRACTS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

describe('desktop interface sound preference', () => {
  it('serves and saves before setup, then keeps off after the agent restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'taalcut-interface-sounds-'));
    const config = testConfig('agent', join(directory, 'library.sqlite'), directory);
    const first = testAgent(config);
    try {
      const port = nodeChannel();
      serveRpc(first.router, port.local, { context: { caller: 'main' } });
      const client = connectRpc(UTILITY_CONTRACTS.agent, port.remote, { peer: 'agent' }).client;
      expect(await client.interfaceSounds.state()).toEqual({ enabled: true, initialized: false });
      await client.commands.dispatch({
        name: SETTINGS_COMMANDS.initializeInterfaceSounds,
        payload: { enabled: false },
        source: 'ui',
      });
      expect(await client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
    } finally {
      closeAllPorts();
      await first.container.dispose();
    }
    const second = testAgent(config);
    try {
      const port = nodeChannel();
      serveRpc(second.router, port.local, { context: { caller: 'main' } });
      const client = connectRpc(UTILITY_CONTRACTS.agent, port.remote, { peer: 'agent' }).client;
      expect(await client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
      await client.commands.dispatch({
        name: SETTINGS_COMMANDS.initializeInterfaceSounds,
        payload: { enabled: true },
        source: 'ui',
      });
      expect(await client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
    } finally {
      closeAllPorts();
      await second.container.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
