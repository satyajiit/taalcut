// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { callRpc, err, ok, type AsyncResult, type Container } from '@taalcut/core';
import {
  assembleToolchain,
  CreationSourceFailed,
  WORKSPACE_TOOLCHAIN,
  type CreationCapture,
  type CreationProjectExecution,
} from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { AgentMainServicesToken, ComponentManagerToken } from '../../shared/tokens';
import { sandboxProfilesDir } from '../roots/template-sandbox';
import { defaultBackend } from '@taalcut/tools';
import { linuxShellBackend } from '../roots/workspace-shell-linux';
import { hostPlatform } from '../../platform';
import { runCreationProject, type CreationProjectExecutionDeps } from './project-execution';

async function managedCreationNode(
  container: Container,
  signal: AbortSignal,
): AsyncResult<{ path: string; version: string }> {
  const id = WORKSPACE_TOOLCHAIN.node.componentId;
  if (container.has(ComponentManagerToken)) {
    const manager = container.resolve(ComponentManagerToken);
    const installed = await manager.get(id);
    return installed ? ok(installed) : manager.install(id, { signal });
  }
  if (!container.has(AgentMainServicesToken))
    return err(CreationSourceFailed(undefined, { detail: 'Managed Node is unavailable.' }));
  const components = container.resolve(AgentMainServicesToken)().components;
  const installed = await callRpc(components.get({ id }, { signal }));
  if (!installed.ok) return installed;
  return installed.value ? ok(installed.value) : callRpc(components.install({ id }, { signal }));
}

export async function creationToolchain(
  container: Container,
  config: UtilityConfig,
  signal: AbortSignal,
): AsyncResult<Pick<CreationProjectExecutionDeps, 'toolchain' | 'packageManagers' | 'backend'>> {
  const installed = await managedCreationNode(container, signal);
  if (!installed.ok) return installed;
  try {
    const require = createRequire(import.meta.url);
    const packagePath = async (name: string) =>
      realpath(
        config.packaged
          ? join(config.resourcesPath, 'project-tools', name)
          : dirname(require.resolve(name === 'pnpm' ? 'pnpm' : 'npm/package.json')),
      );
    const packageManagers = { npm: await packagePath('npm'), pnpm: await packagePath('pnpm') };
    return ok({
      toolchain: assembleToolchain({ components: { node: installed.value } }),
      packageManagers,
      backend:
        hostPlatform().workspaceShell === 'bwrap'
          ? linuxShellBackend()
          : defaultBackend({ profilesDir: sandboxProfilesDir(config) }),
    });
  } catch {
    return err(
      CreationSourceFailed(undefined, { detail: 'The managed package managers are missing from this app.' }),
    );
  }
}

export async function runManagedCreationProject(options: {
  readonly request: CreationProjectExecution;
  readonly container: Container;
  readonly config: UtilityConfig;
  readonly snapshotRoot: string;
  readonly capture: CreationProjectExecutionDeps['capture'];
  readonly signal: AbortSignal;
}): AsyncResult<CreationCapture> {
  const toolchain = await creationToolchain(options.container, options.config, options.signal);
  if (!toolchain.ok) return toolchain;
  return runCreationProject(options.request, {
    ...toolchain.value,
    snapshotRoot: options.snapshotRoot,
    scratchRoot: join(options.config.userData, 'creation', 'sessions'),
    capture: options.capture,
    signal: options.signal,
  });
}
