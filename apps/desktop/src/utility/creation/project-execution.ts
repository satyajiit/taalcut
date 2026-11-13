// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { access, cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CancelledError, err, newId, type AsyncResult } from '@taalcut/core';
import {
  createShellRunner,
  CreationSourceFailed,
  defaultBackend,
  ensureShellFolder,
  type BackendFor,
  type CreationCapture,
  type CreationProjectExecution,
  type ShellToolchain,
} from '@taalcut/tools';
import { CREATION_PROJECT_BOOTSTRAP } from './project-bootstrap';
import { creationRegistry } from './project-registry';

export interface CreationProjectExecutionDeps {
  readonly snapshotRoot: string;
  readonly scratchRoot: string;
  readonly toolchain: ShellToolchain;
  readonly packageManagers: { readonly npm: string; readonly pnpm: string };
  readonly capture: (url: string, signal: AbortSignal) => AsyncResult<CreationCapture>;
  readonly signal: AbortSignal;
  readonly backend?: BackendFor;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Installation and preview share one bounded process tree; captured source never touches the attached repo. */
export async function runCreationProject(
  request: CreationProjectExecution,
  deps: CreationProjectExecutionDeps,
): AsyncResult<CreationCapture> {
  if (deps.signal.aborted) return err(CancelledError());
  if (
    !['dev', 'start', 'preview'].includes(request.script) ||
    (request.buildScript && request.buildScript !== 'build')
  )
    return err(CreationSourceFailed(undefined, { detail: 'Unsupported project script.' }));
  const id = newId<'Project'>();
  const made = await ensureShellFolder(deps.scratchRoot, id, Date.now());
  if (!made.ok) return made;
  const folder = made.value.folder;
  const work = join(folder, 'work');
  const control = join(folder, 'tmp', 'capture');
  const controller = new AbortController();
  const signal = AbortSignal.any([deps.signal, controller.signal]);
  let registry: Awaited<ReturnType<typeof creationRegistry>> | undefined;
  let task: ReturnType<ReturnType<typeof createShellRunner>['run']> | undefined;
  try {
    await mkdir(control, { recursive: true });
    const snapshot = await realpath(deps.snapshotRoot);
    await cp(snapshot, work, {
      recursive: true,
      dereference: false,
      force: false,
      errorOnExist: false,
      filter: (path) =>
        !/(?:^|\/)(?:node_modules|\.git|\.env(?:\.[^/]*)?|\.npmrc|\.pnpmfile\.cjs)(?:\/|$)/.test(path),
    });
    const manager = await realpath(deps.packageManagers[request.packageManager]);
    const cli = join(manager, 'bin', request.packageManager === 'npm' ? 'npm-cli.js' : 'pnpm.mjs');
    await access(cli);
    const bootstrap = join(control, 'launch.cjs');
    const settings = join(control, 'settings.json');
    await writeFile(bootstrap, CREATION_PROJECT_BOOTSTRAP);
    await writeFile(
      settings,
      JSON.stringify({
        cli,
        manager: request.packageManager,
        control,
        script: request.script,
        buildScript: request.buildScript,
        install: request.install,
      }),
    );
    let port: number | undefined;
    const backend = deps.backend ?? defaultBackend();
    const runner = createShellRunner({
      root: deps.scratchRoot,
      toolchain: async () => ({ ...deps.toolchain, roots: [...deps.toolchain.roots, manager] }),
      backend: async (root, tools, ports) => {
        registry = await creationRegistry(work, ports[0]!, signal);
        port = ports[1];
        return backend(root, tools, ports);
      },
    });
    let done = false;
    let failure = '';
    task = runner
      .run(
        id,
        {
          command: `node ${quote(bootstrap)} ${quote(settings)}`,
          wallMs: Math.min(request.timeoutMs, 180_000),
          stdoutBytes: 4096,
          stderrBytes: 4096,
        },
        { signal },
      )
      .catch(() => err(CreationSourceFailed(undefined, { detail: 'Project sandbox failed to start.' })));
    void task.then((result) => {
      done = true;
      failure = result.ok ? result.value.stderr || result.value.stdout : result.error.code;
    });
    const deadline = Date.now() + Math.min(request.timeoutMs, 180_000);
    while (!done && !signal.aborted && Date.now() < deadline) {
      if (
        registry &&
        (await access(join(control, 'installed')).then(
          () => true,
          () => false,
        ))
      ) {
        await registry.close();
        registry = undefined;
        await writeFile(join(control, 'registry-closed'), 'done');
      }
      if (port) {
        const url = `http://127.0.0.1:${port}`;
        const reachable = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
        }).then(
          (response) => response.ok,
          () => false,
        );
        if (reachable) return await deps.capture(url, signal);
      }
      await delay(100, undefined, { signal }).catch(() => undefined);
    }
    return err(
      deps.signal.aborted
        ? CancelledError()
        : CreationSourceFailed(undefined, {
            detail: `The isolated project did not start a preview. ${failure}`.slice(0, 1000),
          }),
    );
  } catch (error) {
    return err(
      CreationSourceFailed(undefined, {
        detail: error instanceof Error ? error.message.slice(0, 500) : 'Project execution failed.',
      }),
    );
  } finally {
    controller.abort();
    if (task) await task;
    await registry?.close();
    await rm(folder, { recursive: true, force: true });
  }
}
