// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Linux backend (AGT2 sbx): the distribution's bubblewrap (`/usr/bin/bwrap`, the .deb's `Depends:
 * bubblewrap`; never one found on PATH), with the seccomp filter (seccomp.ts). Every namespace is new: the shell
 * sees its own processes only, a network of its own with nothing but loopback, no host IPC, and no capability. Its
 * file system is built from nothing: the system's /usr read-only (with the merged-/usr links), the few /etc files
 * programs read to load libraries and fonts, a fresh /proc, /dev and /tmp, each toolchain folder read-only, and the
 * shell folder read-write but for its inputs and manifest. No home folder, no /run, no /sys, no GPU device: GPU
 * encodes stay in the app's allow-listed FFmpeg tool. Ubuntu 23.10 and later let bwrap make a user namespace only
 * under the AppArmor profile the .deb installs.
 */
import { join } from 'node:path';
import type { ShellBackend } from './backend';
import { SHELL_DIRS, SHELL_MANIFEST } from './folder';
import { shellSeccompFilter } from './seccomp';

export const BWRAP_PATH = '/usr/bin/bwrap';

/** The top-level folders a merged-/usr system makes links to /usr (`bin -> usr/bin`), or real folders elsewhere. */
export const ROOT_LINKS = ['bin', 'sbin', 'lib', 'lib32', 'lib64', 'libx32'] as const;

/** /etc files programs read on the way: the loader's cache, fonts, the time zone, Debian's alternatives. */
export const ETC_READS = [
  '/etc/ld.so.cache',
  '/etc/ld.so.conf',
  '/etc/ld.so.conf.d',
  '/etc/fonts',
  '/etc/localtime',
  '/etc/alternatives',
] as const;

/** How the host's top-level folders look: a link's target, a folder, or nothing. */
export type RootEntry = { readonly link: string } | 'dir' | null;

export interface BwrapHost {
  readonly root: (name: (typeof ROOT_LINKS)[number]) => RootEntry;
  /** bwrap 0.8 and later: `--disable-userns` (no user namespace inside the shell's). */
  readonly disableUserns: boolean;
  /** x86_64: the seccomp filter applies. */
  readonly seccomp: boolean;
}

/** bwrap's options for one shell folder, before `--`. Paths are real paths. */
export function bwrapArgs(folder: string, toolRoots: readonly string[], host: BwrapHost): string[] {
  const args = ['--unshare-all', '--unshare-user', '--die-with-parent', '--new-session', '--cap-drop', 'ALL'];
  if (host.disableUserns) args.push('--disable-userns');
  args.push('--ro-bind', '/usr', '/usr');
  for (const name of ROOT_LINKS) {
    const entry = host.root(name);
    if (entry === 'dir') args.push('--ro-bind', `/${name}`, `/${name}`);
    else if (entry) args.push('--symlink', entry.link, `/${name}`);
  }
  for (const path of ETC_READS) args.push('--ro-bind-try', path, path);
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/dev/shm', '--tmpfs', '/tmp');
  for (const root of toolRoots) args.push('--ro-bind', root, root);
  args.push(
    '--bind',
    folder,
    folder,
    '--ro-bind',
    join(folder, SHELL_DIRS.inputs),
    join(folder, SHELL_DIRS.inputs),
    '--ro-bind',
    join(folder, SHELL_MANIFEST),
    join(folder, SHELL_MANIFEST),
    '--chdir',
    join(folder, SHELL_DIRS.work),
  );
  if (host.seccomp) args.push('--seccomp', '3');
  return args;
}

/** The backend for one folder. */
export function bwrapBackend(
  folder: string,
  toolRoots: readonly string[],
  host: BwrapHost,
  bwrap = BWRAP_PATH,
): ShellBackend {
  return {
    kind: 'bwrap',
    bwrap,
    args: bwrapArgs(folder, toolRoots, host),
    ...(host.seccomp ? { seccomp: shellSeccompFilter() } : {}),
  };
}

/** `bubblewrap 0.9.0` → whether it has `--disable-userns` (0.8.0 and later). */
export function bwrapHasDisableUserns(versionLine: string): boolean {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionLine);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 0 || minor >= 8;
}

/**
 * What to tell the agent when bwrap can't run the shell, from how it failed. A missing bwrap names the package; a
 * refused user namespace (Ubuntu's AppArmor restriction without Taalcut's profile, or a kernel without them) says
 * so; anything else carries bwrap's own words.
 */
export function bwrapUnavailableDetail(failure: {
  readonly missing?: boolean;
  readonly stderr?: string;
}): string {
  if (failure.missing)
    return 'The workspace shell needs bubblewrap, which is not installed: install the bubblewrap package (sudo apt install bubblewrap), then try again.';
  const said = (failure.stderr ?? '').trim().split('\n')[0] ?? '';
  if (/namespace|setting up uid map|Permission denied|Operation not permitted/i.test(said))
    return `bubblewrap can't make the shell's namespaces here (${said}). On Ubuntu 23.10 and later, reinstall Taalcut's package: it loads the AppArmor profile that lets /usr/bin/bwrap make a user namespace.`;
  return `bubblewrap didn't start the workspace shell: ${said || 'no reason given'}.`;
}
