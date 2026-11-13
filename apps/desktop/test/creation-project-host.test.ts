// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContainer, type MainServicesClient } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { AgentMainServicesToken } from '../src/shared/tokens';
import { creationToolchain } from '../src/utility/creation/project-execution-host';

it('installs managed Node through main when the agent has no local component manager', async () => {
  const get = vi.fn(async () => undefined);
  const install = vi.fn(async () => ({
    id: 'workspace-node',
    path: '/managed/node',
    version: '24',
    notice: '/managed/NOTICE',
  }));
  const client = { components: { get, install } } as unknown as MainServicesClient<'agent'>;
  const container = createContainer().value(AgentMainServicesToken, () => client);
  const signal = new AbortController().signal;
  const result = await creationToolchain(
    container,
    {
      process: 'agent',
      dbPath: ':memory:',
      userData: '/app/data',
      resourcesPath: '/app/resources',
      packaged: false,
      componentManifest: '/app/resources/manifest.json',
    },
    signal,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(get).toHaveBeenCalledWith({ id: 'workspace-node' }, { signal });
  expect(install).toHaveBeenCalledWith({ id: 'workspace-node' }, { signal });
  if (result.ok) {
    expect(result.value.toolchain.roots).toContain('/managed/node');
    expect(result.value.packageManagers.npm).toMatch(/npm/);
    expect(result.value.packageManagers.pnpm).toMatch(/pnpm/);
  }
});
