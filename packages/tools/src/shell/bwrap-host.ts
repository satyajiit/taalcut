// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether this Linux machine can run the workspace shell under bubblewrap (AGT2 sbx), found once and kept while it
 * holds: bwrap is there, says its version, and starts a trial command with every namespace the shell gets. A
 * failure is `sandbox.unavailable` with what to do (bwrapUnavailableDetail) and is looked at afresh next time, so
 * installing bubblewrap or the AppArmor profile needs no restart.
 */
import { execFile } from 'node:child_process';
import { access, constants as fsc, lstat, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { SandboxUnavailable } from '../sandbox/errors';
import {
  BWRAP_PATH,
  bwrapBackend,
  bwrapHasDisableUserns,
  bwrapUnavailableDetail,
  ROOT_LINKS,
  type BwrapHost,
  type RootEntry,
} from './bwrap';
import type { BackendFor } from './shell-runner';

const exec = promisify(execFile);

export interface BwrapProbe {
  readonly bwrap?: string;
  readonly arch?: string;
  readonly run?: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  readonly root?: (name: string) => Promise<RootEntry>;
  readonly executable?: (path: string) => Promise<boolean>;
}

async function rootEntry(name: string): Promise<RootEntry> {
  const info = await lstat(`/${name}`).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink()) return { link: await readlink(`/${name}`) };
  return info.isDirectory() ? 'dir' : null;
}

/** The host as bwrapArgs needs it, or why the shell can't run here. */
export async function probeBwrapHost(probe: BwrapProbe = {}): AsyncResult<BwrapHost> {
  const bwrap = probe.bwrap ?? BWRAP_PATH;
  const run = probe.run ?? ((file, args) => exec(file, [...args], { timeout: 10_000 }));
  const executable =
    probe.executable ??
    ((path) =>
      access(path, fsc.X_OK).then(
        () => true,
        () => false,
      ));
  if (!(await executable(bwrap)))
    return err(SandboxUnavailable(undefined, { detail: bwrapUnavailableDetail({ missing: true }) }));
  const entries = new Map<string, RootEntry>();
  for (const name of ROOT_LINKS) entries.set(name, await (probe.root ?? rootEntry)(name));
  let version: string;
  try {
    version = (await run(bwrap, ['--version'])).stdout;
  } catch (error) {
    return err(
      SandboxUnavailable(undefined, { detail: bwrapUnavailableDetail({ stderr: stderrOf(error) }) }),
    );
  }
  const host: BwrapHost = {
    root: (name) => entries.get(name) ?? null,
    disableUserns: bwrapHasDisableUserns(version),
    seccomp: (probe.arch ?? process.arch) === 'x64',
  };
  // The shell's namespaces, on nothing but /usr: a refused user namespace shows here, before any command.
  const trial = ['--unshare-all', '--unshare-user', '--die-with-parent', '--ro-bind', '/usr', '/usr'];
  for (const name of ROOT_LINKS) {
    const entry = host.root(name);
    if (entry && entry !== 'dir') trial.push('--symlink', entry.link, `/${name}`);
    else if (entry === 'dir') trial.push('--ro-bind', `/${name}`, `/${name}`);
  }
  try {
    await run(bwrap, [...trial, '--', '/usr/bin/true']);
  } catch (error) {
    return err(
      SandboxUnavailable(undefined, { detail: bwrapUnavailableDetail({ stderr: stderrOf(error) }) }),
    );
  }
  return ok(host);
}

const stderrOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'stderr' in error
    ? String((error as { stderr: unknown }).stderr)
    : String(error);

/** The runner's backend on Linux: bwrap once the host is known; dash counts `ulimit -f` in 512-byte blocks. */
export function bwrapBackendFor(probe: BwrapProbe = {}): BackendFor {
  let known: Promise<Awaited<ReturnType<typeof probeBwrapHost>>> | undefined;
  return async (folder, toolchain) => {
    known ??= probeBwrapHost(probe);
    const host = await known;
    if (!host.ok) {
      known = undefined;
      return host;
    }
    return ok({
      backend: bwrapBackend(folder, toolchain.roots, host.value, probe.bwrap ?? BWRAP_PATH),
      fileBlockBytes: 512,
    });
  };
}
