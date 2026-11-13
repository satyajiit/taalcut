// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Workspace shell test helpers: a shell folder in a temp root, a confined run of one command in it, and the
 * programs a test may lend the shell (this Node, the repo's FFmpeg, a chrome-headless-shell). Suites that need
 * sandbox-exec skip with a message off macOS.
 */
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, type ProjectId } from '@taalcut/core';
import { ensureShellFolder, shellEnv, SHELL_DIRS, type ShellToolchain } from '../../src/shell/folder';
import { shellLimits, type ShellLimits } from '../../src/shell/limits';
import { freeLoopbackPorts } from '../../src/shell/loopback';
import { runShell, type ShellRunOptions } from '../../src/shell/run-shell';
import { seatbeltBackend, SANDBOX_EXEC_PATH } from '../../src/shell/seatbelt';
import { tempRoot } from './sandbox';

export function shellSkipReason(): string {
  if (process.platform !== 'darwin') return 'not macOS';
  try {
    accessSync(SANDBOX_EXEC_PATH, constants.X_OK);
  } catch {
    return `${SANDBOX_EXEC_PATH} is missing`;
  }
  return '';
}

/** A shell folder for a made-up project under a fresh temp root. */
export async function shellFolder(): Promise<{
  root: string;
  folder: string;
  projectId: ProjectId;
  cleanup: () => void;
}> {
  const temp = tempRoot('taalcut-shell-');
  const projectId = newId<'Project'>();
  const made = await ensureShellFolder(join(temp.root, 'shell'), projectId, Date.now());
  if (!made.ok) throw new Error(made.error.code);
  return { root: temp.root, folder: made.value.folder, projectId, cleanup: temp.cleanup };
}

/** This test's Node, lent to the shell as a toolchain folder. */
export function nodeToolchain(): ShellToolchain {
  const bin = dirname(realpathSync(process.execPath));
  return {
    roots: [dirname(bin)],
    bin: [bin],
    env: {},
    programs: [{ name: 'node', version: process.version }],
  };
}

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** A chrome-headless-shell folder: TAALCUT_HEADLESS_SHELL_DIR, render's fetched copy, or HyperFrames' cache. */
export function findHeadlessShell(): string | null {
  const candidates = [
    process.env.TAALCUT_HEADLESS_SHELL_DIR,
    join(REPO, 'packages/render/.cache/chrome-headless-shell/chrome-headless-shell-mac-arm64'),
    join(
      homedir(),
      '.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-157.0.8103.50/chrome-headless-shell-mac-arm64',
    ),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'chrome-headless-shell'))) return realpathSync(dir);
  }
  return null;
}

/** Runs `command` in `folder`'s work/ under workspace.sb with the toolchain and limits given. */
export async function confined(
  folder: string,
  command: string,
  options: {
    toolchain?: ShellToolchain;
    limits?: Partial<ShellLimits>;
    run?: ShellRunOptions;
    stdoutBytes?: number;
  } = {},
) {
  const toolchain = options.toolchain ?? { roots: [], bin: [], env: {}, programs: [] };
  const ports = await freeLoopbackPorts();
  const backend = await seatbeltBackend(folder, toolchain.roots, ports);
  if (!backend.ok) throw new Error(backend.error.code);
  const limits = shellLimits({ wallMs: 60_000, ...options.limits });
  return runShell(
    {
      backend: backend.value,
      command,
      cwd: join(folder, SHELL_DIRS.work),
      env: shellEnv(folder, toolchain, ports),
      limits,
      watch: { dir: folder, maxBytes: limits.diskBytes },
      output: { stdoutBytes: options.stdoutBytes ?? 16 * 1024, stderrBytes: 16 * 1024 },
      fileBlockBytes: 1024,
    },
    options.run,
  );
}

/** Whether a pid is running (signal 0). */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
