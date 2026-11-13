// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-CMP: the environment a utility process is forked with, so the CUDA builds find cuda-runtime-13's libraries
 * (glibc reads LD_LIBRARY_PATH only when a process starts). The real load is the host smoke test
 * (linux-components-host.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { hostPlatform } from '../src/platform';
import { acceleratorEnv, withAcceleratorEnv } from '../src/utility/accelerator-env';

const ROOT = '/home/u/.config/Taalcut/components';
const CUDA = `${ROOT}/installed/cuda-runtime-13/13.4.3-cudnn9.27.0-892e7524e0cd`;
const installed = (root: string, id: string) =>
  root === ROOT && id === 'cuda-runtime-13' ? CUDA : undefined;
const none = () => undefined;
const linux = hostPlatform('linux').loaderSearchPath;

describe('acceleratorEnv', () => {
  it('puts the CUDA runtime first on LD_LIBRARY_PATH, keeping what was there once', () => {
    expect(
      acceleratorEnv({ componentsRoot: ROOT, searchPath: linux, env: {}, installedDir: installed }),
    ).toEqual({
      LD_LIBRARY_PATH: `${CUDA}/lib`,
    });
    const env = { LD_LIBRARY_PATH: `/opt/x/lib::${CUDA}/lib` };
    expect(acceleratorEnv({ componentsRoot: ROOT, searchPath: linux, env, installedDir: installed })).toEqual(
      {
        LD_LIBRARY_PATH: `${CUDA}/lib:/opt/x/lib`,
      },
    );
  });

  it('sets nothing without the component, on macOS, or on Windows (a slot for now)', () => {
    expect(acceleratorEnv({ componentsRoot: ROOT, searchPath: linux, env: {}, installedDir: none })).toEqual(
      {},
    );
    for (const platform of ['darwin', 'win32'] as const)
      expect(
        acceleratorEnv({
          componentsRoot: ROOT,
          searchPath: hostPlatform(platform).loaderSearchPath,
          installedDir: installed,
        }),
      ).toEqual({});
  });
});

describe('withAcceleratorEnv', () => {
  const options = { searchPath: linux, env: { PATH: '/usr/bin', HOME: '/home/u' }, installedDir: installed };

  it("forks an inheriting process with main's environment and the CUDA runtime", () => {
    expect(withAcceleratorEnv({}, ROOT, options)).toEqual({
      env: { PATH: '/usr/bin', HOME: '/home/u', LD_LIBRARY_PATH: `${CUDA}/lib` },
    });
  });

  it('leaves a minimal environment (mcp, lan) and a machine without the runtime alone', () => {
    const minimal = { env: { PATH: '/usr/bin' } };
    expect(withAcceleratorEnv(minimal, ROOT, options)).toBe(minimal);
    const bare = {};
    expect(withAcceleratorEnv(bare, ROOT, { ...options, installedDir: none })).toBe(bare);
  });

  it('runtimes from components only: the person’s LD_LIBRARY_PATH never reaches the process (UX3-IDX)', () => {
    // Another libonnxruntime.so.1 or CUDA build there would come before the component's RUNPATH.
    const env = { PATH: '/usr/bin', LD_LIBRARY_PATH: '/usr/local/cuda/lib64:/opt/onnxruntime/lib' };
    const managed = { ...options, env, managedOnly: true };
    expect(withAcceleratorEnv({}, ROOT, managed)).toEqual({
      env: { PATH: '/usr/bin', LD_LIBRARY_PATH: `${CUDA}/lib` },
    });
    expect(withAcceleratorEnv({}, ROOT, { ...managed, installedDir: none })).toEqual({
      env: { PATH: '/usr/bin' },
    });
    expect(acceleratorEnv({ componentsRoot: ROOT, ...managed })).toEqual({ LD_LIBRARY_PATH: `${CUDA}/lib` });
    // A checkout keeps them after the component's folder, as before.
    expect(withAcceleratorEnv({}, ROOT, { ...options, env })).toEqual({
      env: { PATH: '/usr/bin', LD_LIBRARY_PATH: `${CUDA}/lib:/usr/local/cuda/lib64:/opt/onnxruntime/lib` },
    });
    // Nothing to strip: unchanged.
    const bare = {};
    expect(withAcceleratorEnv(bare, ROOT, { ...options, installedDir: none, managedOnly: true })).toBe(bare);
  });
});
