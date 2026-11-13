// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The environment a process that loads GPU runtimes starts with (LNX1-CMP; plan/linux-round-1.md, seams 2 and 4).
 * The CUDA builds (onnxruntime-cuda's provider, local-llm-runtime-cuda, whisper-server-cuda) link CUDA 13's
 * libraries by name, and those come from one shared component, `cuda-runtime-13`, installed in its own folder.
 * On Linux the loader finds them through LD_LIBRARY_PATH, which glibc reads once, when a process starts: so the
 * folder has to be in the environment a utility process is forked with, and in the one a sidecar (llama-server,
 * whisper-server) is spawned with. A process forked before the component was installed finds it at its next start.
 *
 * Why not a RUNPATH patched in at pack time: a component's folder is `installed/<id>/<version>-<sha12>`, so a
 * relative path from one component to another changes with every version of either, and a pack would have to
 * know the other's bytes. The variable is computed from the registry when the process starts, so it is right for
 * whatever is installed, and it reaches every child the process spawns.
 */
import { join } from 'node:path';
import { installedComponentDirSync } from '@taalcut/jobs';
import { hostPlatform } from '../platform';
import type { LoaderSearchPath } from '../platform/types';

/** The CUDA 13 libraries (cudart, cuBLAS/Lt, cuRAND, NVRTC, cuDNN 9) the CUDA builds load. */
export const CUDA_RUNTIME_COMPONENT = 'cuda-runtime-13';

/** Components that hold libraries other components load, and the folder inside each that holds them. */
export const ACCELERATOR_LIBRARIES: readonly { readonly component: string; readonly dir: string }[] = [
  { component: CUDA_RUNTIME_COMPONENT, dir: 'lib' },
];

export interface AcceleratorEnvOptions {
  /** `<userData>/components`. */
  readonly componentsRoot: string;
  /** The loader's search path variable; default the platform services' (platform/types.ts). */
  readonly searchPath?: LoaderSearchPath | undefined;
  /** What the process would inherit. Default process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam: an installed component's folder (default the registry's). */
  readonly installedDir?: (root: string, id: string) => string | undefined;
  /**
   * Runtimes from components only (a packaged app; a development run installing from a local release): the
   * variable holds the components' folders and nothing the person's environment set (UX3-IDX). An inherited
   * LD_LIBRARY_PATH comes before a library's RUNPATH, so an entry holding another libonnxruntime.so.1 or CUDA
   * build would shadow the component's.
   */
  readonly managedOnly?: boolean;
}

/**
 * The variables to set for a process so it finds the installed accelerator libraries: their folders first, then
 * what the variable already held (not with `managedOnly`). Empty when none is installed or the platform needs none.
 */
export function acceleratorEnv(options: AcceleratorEnvOptions): Record<string, string> {
  const search = 'searchPath' in options ? options.searchPath : hostPlatform().loaderSearchPath;
  if (!search) return {};
  const installedDir = options.installedDir ?? installedComponentDirSync;
  const dirs = ACCELERATOR_LIBRARIES.flatMap(({ component, dir }) => {
    const at = installedDir(options.componentsRoot, component);
    return at ? [join(at, dir)] : [];
  });
  if (dirs.length === 0) return {};
  const held = options.managedOnly ? '' : ((options.env ?? process.env)[search.variable] ?? '');
  const rest = held.split(search.separator).filter((part) => part !== '' && !dirs.includes(part));
  return { [search.variable]: [...dirs, ...rest].join(search.separator) };
}

/** process.env without its unset entries, as utilityProcess.fork and spawn take it. */
function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * utilityProcess.fork options with the accelerator variables. A process given a minimal environment of its own
 * (mcp, lan: they parse network input and load no runtime) keeps it; one that inherits main's gets main's plus
 * the variables, and only when there are any. With `managedOnly` it gets main's without the loader's search path
 * the person set, whether or not there are any.
 */
export function withAcceleratorEnv<T extends { readonly env?: Record<string, string> }>(
  fork: T,
  componentsRoot: string,
  options: Omit<AcceleratorEnvOptions, 'componentsRoot'> = {},
): T | (T & { env: Record<string, string> }) {
  if (fork.env) return fork;
  const extra = acceleratorEnv({ ...options, componentsRoot });
  const inherited = definedEnv(options.env ?? process.env);
  const search = 'searchPath' in options ? options.searchPath : hostPlatform().loaderSearchPath;
  if (options.managedOnly && search && inherited[search.variable] !== undefined) {
    delete inherited[search.variable];
    return { ...fork, env: { ...inherited, ...extra } };
  }
  if (Object.keys(extra).length === 0) return fork;
  return { ...fork, env: { ...inherited, ...extra } };
}
