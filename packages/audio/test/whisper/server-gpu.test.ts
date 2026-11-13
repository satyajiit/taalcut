// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1: a GPU build of whisper-server on Linux. It gets the loader's and CUDA's variables (cuda-runtime-13 is on the
 * jobs process's LD_LIBRARY_PATH, glibc reads it only at a process's start), and a load that dies on CUDA, Vulkan or
 * a missing library counts as a GPU failure, so the CPU build starts instead. The desktop's accelerator variables are
 * read at each spawn, so a cuda-runtime-13 installed after the jobs process started reaches the next server.
 */
import { describe, expect, it } from 'vitest';
import { GPU_FAILURE } from '../../src/whisper/server-process';
import { createPosixServerSpawn, serverEnv } from '../../src/whisper/server-spawn';

describe('whisper-server on a GPU build', () => {
  it("passes the loader's path and CUDA's device list, and nothing else of this process's", () => {
    expect(
      serverEnv({
        PATH: '/usr/bin',
        HOME: '/home/u',
        LD_LIBRARY_PATH: '/c/cuda-runtime-13/lib',
        CUDA_VISIBLE_DEVICES: '0',
        TAALCUT_SECRET: 'x',
      }),
    ).toMatchObject({
      PATH: '/usr/bin',
      LD_LIBRARY_PATH: '/c/cuda-runtime-13/lib',
      CUDA_VISIBLE_DEVICES: '0',
    });
    const env = serverEnv({ PATH: '/usr/bin', TAALCUT_SECRET: 'x' });
    expect(env['TAALCUT_SECRET']).toBeUndefined();
    expect(env['LD_LIBRARY_PATH']).toBeUndefined();
  });

  it('takes CUDA, Vulkan, Metal and loader errors for a GPU that failed', () => {
    for (const line of [
      './whisper-server: error while loading shared libraries: libcudart.so.13: cannot open shared object file',
      'ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected',
      'ggml_vulkan: vk::createInstance: ErrorIncompatibleDriver',
      'ggml_metal_init: error: failed to create MTLDevice',
    ])
      expect(GPU_FAILURE.test(line)).toBe(true);
    expect(GPU_FAILURE.test('error: failed to open model file ggml-small.bin')).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'reads the extra variables at each spawn, over the inherited ones',
    async () => {
      let extra: Record<string, string> = {};
      const spawnServer = createPosixServerSpawn(() => extra);
      const libraryPath = async () => {
        const lines: string[] = [];
        const server = spawnServer({
          command: '/bin/sh',
          args: ['-c', 'echo "lib=$LD_LIBRARY_PATH"'],
          cwd: '/',
          onLine: (line) => lines.push(line),
        });
        await server.exited;
        return lines.find((line) => line.startsWith('lib='));
      };
      const inherited = process.env['LD_LIBRARY_PATH'] ?? '';
      expect(await libraryPath()).toBe(`lib=${inherited}`);
      extra = { LD_LIBRARY_PATH: '/components/cuda-runtime-13/1/lib' };
      expect(await libraryPath()).toBe('lib=/components/cuda-runtime-13/1/lib');
    },
  );
});
