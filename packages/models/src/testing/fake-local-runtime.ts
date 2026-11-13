// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fakes for the embedded local runtime (D16): a component installer that
 * only records, and a driver whose "runtime" is whatever endpoint the test
 * points it at (a mock server, or a local server in an optional integration
 * test). The real llama-server driver runs against a fake server script in
 * this package's tests.
 */
import { err, ok, type TaalcutError } from '@taalcut/core';
import { selectCompute, type ComputeBackend } from '../hardware/compute';
import type {
  ComponentInstaller,
  InstalledComponentRef,
  LaunchInput,
  LocalRuntimeDriver,
  LocalRuntimeEndpoint,
  RunningLocalRuntime,
} from '../local-runtime/types';

export interface MemoryComponentInstaller extends ComponentInstaller {
  readonly installed: readonly string[];
  /** The next install of `id` fails with `error`. */
  failNext(id: string, error: TaalcutError): void;
}

export interface MemoryComponentInstallerOptions {
  /** Component id → file name, for single-file components (model weights): sets `file`. */
  readonly files?: Readonly<Record<string, string>>;
  /** Component id → the build an install asking for the `variant` takes instead (what the download set picks). */
  readonly variants?: Readonly<Record<string, string>>;
}

export function createMemoryComponentInstaller(
  options: MemoryComponentInstallerOptions = {},
): MemoryComponentInstaller {
  const installed = new Map<string, InstalledComponentRef>();
  const failures = new Map<string, TaalcutError>();
  return {
    get installed() {
      return [...installed.keys()];
    },
    failNext: (id, error) => void failures.set(id, error),
    async install(asked, installOptions) {
      const id = (installOptions?.variant && options.variants?.[asked]) || asked;
      const failure = failures.get(id);
      if (failure) {
        failures.delete(id);
        return err(failure);
      }
      const fileName = options.files?.[id];
      const path = `/components/${id}`;
      const ref = installed.get(id) ?? {
        id,
        version: 'test',
        path,
        ...(fileName ? { file: `${path}/${fileName}` } : {}),
      };
      installed.set(id, ref);
      return ok(ref);
    },
    get: async (id) => installed.get(id),
  };
}

export interface FakeLocalRuntimeDriver extends LocalRuntimeDriver {
  readonly launches: readonly LaunchInput[];
  /** Makes the running instance exit as if it crashed. */
  crash(code?: number): void;
  /** What loadedModels() reports for a model. Default: the backend selection would pick. */
  setBackend(model: string, backend: ComputeBackend): void;
  /** The next launch throws. */
  failNextLaunch(message: string): void;
}

export function createFakeLocalRuntimeDriver(endpoint: () => LocalRuntimeEndpoint): FakeLocalRuntimeDriver {
  const launches: LaunchInput[] = [];
  const backends = new Map<string, ComputeBackend>();
  let exit: ((value: { code: number | null; reason?: string }) => void) | undefined;
  let launchFailure: string | undefined;

  return {
    launches,
    crash(code = 1) {
      exit?.({ code, reason: 'crashed' });
      exit = undefined;
    },
    setBackend: (model, backend) => void backends.set(model, backend),
    failNextLaunch(message) {
      launchFailure = message;
    },
    async launch(input): Promise<RunningLocalRuntime> {
      launches.push(input);
      if (launchFailure) {
        const message = launchFailure;
        launchFailure = undefined;
        throw new Error(message);
      }
      const exited = new Promise<{ code: number | null; reason?: string }>((resolve) => {
        exit = resolve;
      });
      return {
        endpoint: endpoint(),
        exited,
        async stop() {
          exit?.({ code: 0 });
          exit = undefined;
        },
        loadedModels: async () =>
          input.models.map(({ model }) => ({
            id: model.id,
            backend: backends.get(model.id) ?? selectCompute(model.compute, input.backends).backend,
          })),
      };
    },
  };
}
