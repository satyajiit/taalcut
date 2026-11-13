// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A SpawnPort for tests, built on the real Node adapter
 * (createNodeSpawnPort): it runs the fake server script under this Node in
 * place of llama-server (or the real binary, for the optional live test) and
 * records what it started.
 */
import { fileURLToPath } from 'node:url';
import type { SidecarExit, SidecarProcess, SpawnPort, SpawnRequest } from '@taalcut/models';
import { createNodeSpawnPort } from '@taalcut/models/node';

export { findFreeLoopbackPort as freeLoopbackPort } from '@taalcut/models/node';

const FAKE_SERVER = fileURLToPath(new URL('../fixtures/fake-llama-server.mjs', import.meta.url));

export interface SpawnedSidecar extends SpawnRequest {
  readonly process: SidecarProcess;
  readonly exited: Promise<SidecarExit>;
  /** Set once it has exited. */
  readonly exit: () => SidecarExit | undefined;
}

export interface FakeSidecarSpawn extends SpawnPort {
  readonly spawned: readonly SpawnedSidecar[];
  /** FAKE_* switches for the next spawns (see fake-llama-server.mjs). */
  setControl(env: Readonly<Record<string, string>>): void;
  killAll(): Promise<void>;
}

/** Runs fake-llama-server.mjs in place of the requested command; `real` runs the command itself. */
export function createFakeSidecarSpawn(options: { readonly real?: boolean } = {}): FakeSidecarSpawn {
  const port = createNodeSpawnPort();
  const spawned: SpawnedSidecar[] = [];
  let switches: Readonly<Record<string, string>> = {};
  return {
    spawned,
    setControl(env) {
      switches = env;
    },
    spawn(request) {
      const started = port.spawn({
        ...request,
        command: options.real ? request.command : process.execPath,
        args: options.real ? request.args : [FAKE_SERVER, ...request.args],
        env: { ...request.env, ...switches },
      });
      let exit: SidecarExit | undefined;
      const exited = started.exited.then((info) => (exit = info));
      spawned.push({ ...request, process: started, exited, exit: () => exit });
      return started;
    },
    async killAll() {
      port.dispose();
      await Promise.all(spawned.map((s) => s.exited));
    },
  };
}
