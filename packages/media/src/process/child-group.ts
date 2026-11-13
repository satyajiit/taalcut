// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a sidecar process gets from us: its own process group, so a stop
 * reaches everything it started, and a minimal environment, so it never sees
 * the app's secrets or settings.
 */
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/** Process groups are POSIX. On Windows the runner signals the direct child only. */
export const USE_PROCESS_GROUPS = process.platform !== 'win32';

/**
 * Sends `signal` to the child's whole process group (or just the child where
 * groups don't exist). Signal 0 only checks that someone is left. Returns false
 * when nobody is left to signal.
 */
export function signalGroup(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  const pid = child.pid;
  if (pid === undefined) return false;
  try {
    if (USE_PROCESS_GROUPS) process.kill(-pid, signal);
    else if (signal === 0) return child.exitCode === null && child.signalCode === null;
    else child.kill(signal);
    return true;
  } catch {
    // ESRCH: the group is empty. EPERM can't happen for our own children.
    return false;
  }
}

/**
 * Environment variables a sidecar may inherit when the caller doesn't pass `env`. FFmpeg needs none of the rest.
 * `CUDA_VISIBLE_DEVICES`: the hardware probe honours it (`-1` is the CPU-only path), so FFmpeg's CUDA must too.
 * `CUDA_CACHE_PATH`: where the driver keeps the CUDA filters' compiled kernels (see `sidecarEnv`).
 */
export const SIDECAR_ENV_KEYS = [
  'PATH',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CUDA_VISIBLE_DEVICES',
  'CUDA_CACHE_PATH',
] as const;

export interface SidecarEnvOptions {
  /**
   * The bundled MoltenVK ICD. Sets VK_ICD_FILENAMES and VK_DRIVER_FILES (the
   * older and newer loader names) so libplacebo's Vulkan device is MoltenVK
   * from the build, never a driver found elsewhere on the machine.
   */
  readonly vulkanIcd?: string;
  /** Default `process.platform`: on Linux a CUDA kernel cache is set (see `sidecarEnv`). */
  readonly platform?: NodeJS.Platform;
}

/**
 * The default sidecar environment: only SIDECAR_ENV_KEYS, taken from `source`,
 * plus the Vulkan driver when given. Spread it to add your own.
 *
 * On Linux, CUDA_CACHE_PATH defaults to the driver's own folder under the user's home (`~/.nv/ComputeCache`)
 * without passing HOME itself: the driver finds that folder from HOME, and without it every FFmpeg run with a
 * CUDA filter compiles their kernels again (3.4 s, against 0.5 s cached, measured on the RTX 4090 host).
 */
export function sidecarEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
  options: SidecarEnvOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SIDECAR_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  const home = source['HOME'];
  if ((options.platform ?? process.platform) === 'linux' && env['CUDA_CACHE_PATH'] === undefined && home)
    env['CUDA_CACHE_PATH'] = join(home, '.nv', 'ComputeCache');
  if (options.vulkanIcd) {
    env['VK_ICD_FILENAMES'] = options.vulkanIcd;
    env['VK_DRIVER_FILES'] = options.vulkanIcd;
    // MoltenVK logs info lines to stderr; errors only, so stderr tails stay FFmpeg's.
    env['MVK_CONFIG_LOG_LEVEL'] = '1';
  }
  return env;
}
