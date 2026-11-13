// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test): the embedded local runtime for the Local only journey
 * (P3-B10, e2e/make-flow-local-only.e2e.ts) with its components installed beforehand and llama-server replaced
 * by the loopback stand-in (agent-local-standin.ts). Everything else is production: the runtime manager (a
 * lease per on-device call, the GPU handed to exports), the 'on-device' endpoint on the agent's runtime, and
 * the ModelClient with Local only and the Local only profile. agent.ts reaches this module only inside
 * `__TAALCUT_FLAVOUR__ === 'test'` through import(), so release bundles don't contain it.
 *
 *   TAALCUT_TEST_LOCAL_SESSION=<dir>   use the stand-in; it writes <dir>/runtime.json when the runtime starts
 *                                      (the tier and the models it serves) and one line per answered request
 *                                      to <dir>/turns.jsonl
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import {
  attachLocalRuntime,
  createFakeLocalRuntimeDriver,
  createLocalRuntimeManager,
  createMemoryComponentInstaller,
  llamaCppRuntimeSpec,
  type AttachedLocalRuntime,
  type LocalRuntimeManager,
  type LocalRuntimeSlot,
  type ModelRuntime,
} from '@taalcut/models';
import { testEnvDir } from '../../shared/test-env-dir';
import { startOnDeviceStandIn, type OnDeviceStandIn } from './agent-local-standin';

export const LOCAL_SESSION_ENV = 'TAALCUT_TEST_LOCAL_SESSION';

/** The folder the variable names, or undefined when it isn't set. Throws when it isn't an absolute path. */
export function localSessionDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return testEnvDir(LOCAL_SESSION_ENV, env);
}

/** AgentRootOptions.localRuntime for the Local only journey. */
export function standInLocalRuntime(dir: string): (runtime: ModelRuntime) => LocalRuntimeSlot {
  mkdirSync(dir, { recursive: true });
  return (runtime) => {
    let manager: LocalRuntimeManager | undefined;
    let attached: AttachedLocalRuntime | undefined;
    let standIn: OnDeviceStandIn | undefined;
    return {
      async localLease(provider, signal, model) {
        if (!attached) return ok(undefined);
        return attached.localLease(provider, signal, model);
      },
      runtime: () => manager,
      start(hardware) {
        if (manager) return;
        const pending = startOnDeviceStandIn((turn) =>
          appendFileSync(join(dir, 'turns.jsonl'), `${JSON.stringify(turn)}\n`),
        );
        // The weights are "installed beforehand": every component this tier runs is in place before start.
        const installer = createMemoryComponentInstaller();
        const local = createLocalRuntimeManager({
          // The tier's context window (packages/models SPEC "Context windows by tier").
          spec: llamaCppRuntimeSpec(hardware.tier),
          installer,
          driver: createFakeLocalRuntimeDriver(() => ({
            kind: 'openai-compatible',
            baseUrl: standIn?.baseUrl ?? 'http://127.0.0.1:9/v1',
          })),
          backends: hardware.compute.backends,
          tier: hardware.tier,
          log: (event) => console.warn(`[local runtime stand-in] ${JSON.stringify(event)}`),
        });
        manager = local;
        void pending.then(async (started) => {
          standIn = started;
          for (const id of local.componentsFor(hardware.tier)) await installer.install(id);
          attached = attachLocalRuntime(local, [runtime]);
          writeFileSync(
            join(dir, 'runtime.json'),
            JSON.stringify({ tier: hardware.tier, models: local.componentsFor(hardware.tier) }),
          );
        });
      },
      stopForExport: () => (manager ? manager.stopForExport() : Promise.resolve(ok(undefined))),
      resumeAfterExport: () => (manager ? manager.resumeAfterExport() : Promise.resolve(ok(undefined))),
      async dispose() {
        attached?.detach();
        await manager?.stop();
        await standIn?.close();
      },
    };
  };
}
