// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent utility process (out/utility/agent.mjs). SOUL.md is bundled in as text.
 *
 * Test-only code sits behind `__TAALCUT_FLAVOUR__ === 'test'` and is loaded
 * with import(), so release bundles don't contain it.
 */
import soul from '../../../../SOUL.md';
import { ToolModulesToken } from '../shared/tokens';
import { composeAgent, type AgentRootOptions } from './roots/agent-root';
import { exitOnTerminate, runUtility, type UtilityRoot } from './runtime';

/**
 * Test builds: the gate demo's recorded model session instead of real providers, the providers at local
 * mock servers, or the on-device runtime's loopback stand-in, when asked for.
 */
async function testOptions(): Promise<Partial<AgentRootOptions>> {
  const { RECORDED_MODELS_ENV, recordedModelClient } = await import('./roots/agent-recorded-models');
  const { testModelServers } = await import('../shared/test-model-servers');
  const { localSessionDir, standInLocalRuntime } = await import('./roots/agent-local-session');
  const fixtures = process.env[RECORDED_MODELS_ENV];
  const servers = testModelServers();
  // The Local only journey (P3-B10): the production ModelClient, on-device turns from a loopback stand-in.
  const local = localSessionDir();
  return {
    ...(fixtures ? { modelClient: recordedModelClient(fixtures) } : {}),
    ...(servers ? { modelRuntime: servers } : {}),
    ...(local ? { localRuntime: standInLocalRuntime(local) } : {}),
  };
}

/** Test builds recording a session: the tools this process offers become the session's recorded catalogue. */
async function recordTestCatalogues(root: UtilityRoot): Promise<void> {
  const { recordSessionCatalogues } = await import('./roots/agent-recorded-models');
  recordSessionCatalogues(() => root.container.resolve(ToolModulesToken));
}

exitOnTerminate(
  runUtility(
    'agent',
    async (config, main) => {
      const root = composeAgent(config, {
        soul,
        ...(main ? { main } : {}),
        ...(__TAALCUT_FLAVOUR__ === 'test' ? await testOptions() : {}),
      });
      if (__TAALCUT_FLAVOUR__ === 'test') await recordTestCatalogues(root);
      return root;
    },
    process.parentPort,
  ),
);
