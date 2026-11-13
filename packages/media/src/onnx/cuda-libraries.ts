// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Why ONNX Runtime's CUDA provider didn't load, in words a trace can use. onnxruntime-node 1.30 throws only
 * "OrtSessionOptionsAppendExecutionProvider_Cuda: Failed to load shared library"; the library it missed goes to
 * ORT's own stderr log. So the runtime looks for the provider's libraries itself, on the loader's path, and names
 * the missing ones. The provider links CUDA 13's cudart, cuBLAS/Lt and cuRAND 10, and the driver's libcuda
 * (`readelf -d libonnxruntime_providers_cuda.so`); the `cuda-runtime-13` component carries all but the driver's,
 * and the desktop puts its folder on LD_LIBRARY_PATH when it starts a utility process.
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** What libonnxruntime_providers_cuda.so links (onnxruntime-node 1.30.0, linux-x64). */
export const CUDA_PROVIDER_LIBRARIES = [
  'libcudart.so.13',
  'libcublas.so.13',
  'libcublasLt.so.13',
  'libcurand.so.10',
  'libcuda.so.1',
] as const;

/** Where glibc looks after LD_LIBRARY_PATH on Debian and Ubuntu (ld.so.conf), plus CUDA's own install folder. */
const SYSTEM_DIRS = [
  '/lib/x86_64-linux-gnu',
  '/usr/lib/x86_64-linux-gnu',
  '/usr/lib/wsl/lib',
  '/lib64',
  '/usr/lib64',
  '/usr/local/cuda/lib64',
];

export interface LibrarySearch {
  /** LD_LIBRARY_PATH. */
  readonly libraryPath?: string;
  readonly exists?: (path: string) => boolean;
  /**
   * The installed cuda-runtime-13's library folder now, if any (the desktop reads the component registry). The
   * loader read LD_LIBRARY_PATH when this process started, so a runtime installed since then is used from the
   * process's next start: the detail says so rather than "not on LD_LIBRARY_PATH".
   */
  readonly installedRuntime?: () => string | undefined;
}

/** The provider's libraries the loader won't find. */
export function missingCudaLibraries(search: LibrarySearch = {}): string[] {
  const exists = search.exists ?? existsSync;
  const libraryPath = 'libraryPath' in search ? search.libraryPath : process.env['LD_LIBRARY_PATH'];
  const dirs = [...(libraryPath ?? '').split(delimiter).filter(Boolean), ...SYSTEM_DIRS];
  return CUDA_PROVIDER_LIBRARIES.filter((name) => !dirs.some((dir) => exists(join(dir, name))));
}

/** A CUDA session's failure, with the missing libraries named when the provider's library didn't load. */
export function cudaFailureDetail(message: string, search?: LibrarySearch): string {
  if (!/failed to load (shared )?library/i.test(message)) return message;
  const missing = missingCudaLibraries(search);
  if (missing.length === 0) return message;
  return `${message}: ${missing.join(', ')} not found (${missingBecause(missing, search)})`;
}

function missingBecause(missing: readonly string[], search: LibrarySearch = {}): string {
  if (missing.includes('libcuda.so.1')) return 'the NVIDIA driver is not installed';
  const installed = search.installedRuntime?.();
  const exists = search.exists ?? existsSync;
  if (installed && missing.every((name) => exists(join(installed, name))))
    return 'cuda-runtime-13 was installed after this process started: CUDA from its next start';
  return 'cuda-runtime-13 is not on LD_LIBRARY_PATH';
}
