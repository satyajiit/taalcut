// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a workspace shell command runs (AGT2 sbx), as the experiment sandbox does it: in the jobs process (exec
 * mode) the runner confines and starts the child; in the agent process (job mode) it enqueues the `workspace.shell`
 * job, so children always start in the jobs process. Exec mode picks the backend by platform (Seatbelt on macOS,
 * bubblewrap on Linux, given by the caller), the toolchain from the components, and keeps the folder's size under
 * both its cap and the disk's free space less a reserve.
 */
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  registerJob,
  type AsyncResult,
  type JobRegistration,
  type JobRunner,
  type ProjectId,
} from '@taalcut/core';
import { SandboxUnavailable } from '../sandbox/errors';
import { folderBytes } from '../sandbox/paths';
import type { ShellBackend } from './backend';
import { ensureShellFolder, shellEnv, SHELL_DIRS, type ShellToolchain } from './folder';
import { shellLimits, type ShellLimits } from './limits';
import { freeLoopbackPorts } from './loopback';
import type { ListProcesses } from './process-watch';
import { runShell, type ShellRunResult } from './run-shell';
import { seatbeltBackend, type SeatbeltOptions } from './seatbelt';
import { workspaceShellJob } from './job';

export interface ShellCommandRequest {
  readonly command: string;
  readonly wallMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface ShellRunner {
  /** Runs one command in the project's shell folder (made if it isn't there). */
  run(
    projectId: ProjectId,
    request: ShellCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<ShellRunResult>;
}

/** A backend for one folder and run (its loopback ports), and how its `sh` counts `ulimit -f` blocks. */
export type BackendFor = (
  folder: string,
  toolchain: ShellToolchain,
  ports: readonly number[],
) => AsyncResult<{ readonly backend: ShellBackend; readonly fileBlockBytes: number }>;

export interface ExecShellRunnerOptions {
  /** `<userData>/shell`. */
  readonly root: string;
  /** The toolchain now (components install on first use). */
  readonly toolchain: () => Promise<ShellToolchain>;
  /** Default: Seatbelt on macOS; anything else is `sandbox.unavailable` unless given (bwrap.ts on Linux). */
  readonly backend?: BackendFor;
  readonly seatbelt?: SeatbeltOptions;
  readonly limits?: Partial<ShellLimits>;
  /** Free space each command leaves on the disk. Default 2 GiB. */
  readonly freeSpaceReserve?: number;
  readonly clock?: () => number;
  readonly list?: ListProcesses;
}

export const SHELL_FREE_SPACE_RESERVE = 2 * 1024 ** 3;

async function freeBytes(dir: string): Promise<number> {
  const info = await statfs(dir).catch(() => null);
  return info ? Number(info.bavail) * Number(info.bsize) : Number.POSITIVE_INFINITY;
}

/** Seatbelt on macOS. */
export function defaultBackend(seatbelt: SeatbeltOptions = {}): BackendFor {
  return async (folder, toolchain, ports) => {
    if (process.platform !== 'darwin')
      return err(
        SandboxUnavailable(undefined, { detail: `no workspace shell backend on ${process.platform}` }),
      );
    const backend = await seatbeltBackend(folder, toolchain.roots, ports, seatbelt);
    // macOS's /bin/sh is bash, which counts `ulimit -f` in KiB.
    return backend.ok ? { ok: true, value: { backend: backend.value, fileBlockBytes: 1024 } } : backend;
  };
}

function execRunner(options: ExecShellRunnerOptions): ShellRunner {
  const backendFor = options.backend ?? defaultBackend(options.seatbelt);
  const clock = options.clock ?? Date.now;
  const reserve = options.freeSpaceReserve ?? SHELL_FREE_SPACE_RESERVE;
  return {
    async run(projectId, request, runOptions = {}) {
      const made = await ensureShellFolder(options.root, projectId, clock());
      if (!made.ok) return made;
      const { folder } = made.value;
      const toolchain = await options.toolchain();
      const ports = await freeLoopbackPorts();
      const backend = await backendFor(folder, toolchain, ports);
      if (!backend.ok) return backend;
      const limits = shellLimits({ ...options.limits, wallMs: request.wallMs });
      const used = await folderBytes(folder);
      const maxBytes = Math.min(limits.diskBytes, used + (await freeBytes(folder)) - reserve);
      return runShell(
        {
          backend: backend.value.backend,
          command: request.command,
          cwd: join(folder, SHELL_DIRS.work),
          env: shellEnv(folder, toolchain, ports),
          limits,
          watch: { dir: folder, maxBytes: Math.max(used, maxBytes) },
          output: { stdoutBytes: request.stdoutBytes, stderrBytes: request.stderrBytes },
          fileBlockBytes: backend.value.fileBlockBytes,
        },
        {
          ...(runOptions.signal ? { signal: runOptions.signal } : {}),
          ...(options.list ? { list: options.list } : {}),
          now: clock,
        },
      );
    },
  };
}

function jobRunner(jobs: JobRunner): ShellRunner {
  return {
    run: (projectId, request, runOptions = {}) =>
      jobs.run(
        workspaceShellJob,
        { projectId, request: { ...request } },
        runOptions.signal ? { signal: runOptions.signal } : {},
      ),
  };
}

export function createShellRunner(
  options: ExecShellRunnerOptions | { readonly jobs: JobRunner },
): ShellRunner {
  return 'jobs' in options ? jobRunner(options.jobs) : execRunner(options);
}

/** The jobs process registers this with its exec-mode runner. */
export function createShellJobs(runner: ShellRunner): JobRegistration[] {
  return [
    registerJob(workspaceShellJob, (input, context) =>
      runner.run(input.projectId, input.request, { signal: context.signal }),
    ),
  ];
}
