// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's limits (AGT2 sbx): generic caps, sized for a video workspace (FFmpeg, Python, a headless
 * render), not for any one task. A call may ask for less time or more output, never more than the caps.
 */
import { totalmem } from 'node:os';

export interface ShellLimits {
  /** Wall clock for the whole command. */
  readonly wallMs: number;
  /** CPU seconds per process (`ulimit -t`): a guard for a process that escaped the tree, not the main cap. */
  readonly cpuSeconds: number;
  /** Resident memory of the whole tree, by the watchdog. */
  readonly memoryBytes: number;
  /** The largest file one process may write (`ulimit -f`). */
  readonly maxFileBytes: number;
  /** The shell folder's size, polled while the command runs and checked after. */
  readonly diskBytes: number;
  /** Open files per process (`ulimit -n`). */
  readonly openFiles: number;
  /** Processes the tree may add to this user's count (`ulimit -u` over the count when it starts). */
  readonly processes: number;
}

const GiB = 1024 ** 3;

/** 2 minutes by default; a call may ask for up to 15 (a render of a long clip). */
export const SHELL_DEFAULT_WALL_MS = 120_000;
export const SHELL_MAX_WALL_MS = 900_000;

/** The caps. Memory: 4 GiB or a third of this Mac's, whichever is less. */
export function shellLimits(overrides: Partial<ShellLimits> = {}): ShellLimits {
  return {
    wallMs: SHELL_DEFAULT_WALL_MS,
    cpuSeconds: (SHELL_MAX_WALL_MS / 1000) * 8,
    memoryBytes: Math.min(4 * GiB, Math.floor(totalmem() / 3)),
    maxFileBytes: 4 * GiB,
    diskBytes: 8 * GiB,
    openFiles: 4096,
    processes: 512,
    ...overrides,
  };
}

/** How often the watchdog and the disk poll look. */
export const SHELL_POLL_MS = 500;
/** SIGTERM, then SIGKILL after this. */
export const SHELL_KILL_GRACE_MS = 2000;

/** What a call sees of its output: head and tail of stdout, the tail of stderr. */
export const SHELL_OUTPUT = {
  /** Default and most stdout bytes a call gets back. */
  stdout: 6 * 1024,
  stdoutMax: 64 * 1024,
  stderr: 3 * 1024,
  stderrMax: 16 * 1024,
} as const;
