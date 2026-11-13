// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The persistent whisper pool against a fake `whisper-server` (a Node script with the same arguments and routes):
 * one load serves many calls, idle servers stop, a crash is retried once on a new process, a GPU that fails
 * falls back to the CPU and says so, an abort keeps the process, and orphans of a dead owner are stopped.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComputeFallbackEvent } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServerRegistry } from '../../src/whisper/server-registry';
import { createWhisperServerPool, type WhisperServerPoolDeps } from '../../src/whisper/server-pool';
import { freeLoopbackPort, posixServerSpawn, type ServerSpawn } from '../../src/whisper/server-spawn';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FAKE = fileURLToPath(new URL('../fixtures/fake-whisper-server.ts', import.meta.url));

const fakeSpawn: ServerSpawn = (request) =>
  posixServerSpawn({
    ...request,
    command: process.execPath,
    args: ['--import', 'tsx', FAKE, ...request.args],
    cwd: PACKAGE_DIR,
  });

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process.
    return false;
  }
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let dir: string;
let audio: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-whisper-pool-'));
  audio = join(dir, 'speech.wav');
  await writeFile(audio, 'RIFF');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function poolWith(overrides: Partial<WhisperServerPoolDeps> = {}) {
  const fallbacks: ComputeFallbackEvent[] = [];
  const pool = createWhisperServerPool({
    launch: { spawn: fakeSpawn, fetch, freePort: freeLoopbackPort, workDir: dir, healthIntervalMs: 25 },
    accelerator: 'metal',
    onFallback: (event) => fallbacks.push(event),
    ...overrides,
  });
  return { pool, fallbacks };
}

async function served(model: string): Promise<{ pids: string[]; fields: Record<string, string>[] }> {
  const lines = (await readFile(`${model}.log`, 'utf8')).trim().split('\n');
  const parsed = lines.filter((line) => !line.endsWith('aborted')).map((line) => line.split(' ', 2));
  return {
    pids: [...new Set(parsed.map(([pid]) => pid ?? ''))],
    fields: lines
      .filter((line) => !line.endsWith('aborted'))
      .map((line) => JSON.parse(line.slice(line.indexOf(' ') + 1)) as Record<string, string>),
  };
}

describe('whisper server pool', () => {
  it('loads a model once and answers every call from it', async () => {
    const { pool, fallbacks } = poolWith();
    const decoder = pool.decoder('whisper-server');
    const model = join(dir, 'ggml-small-q8_0.bin');
    try {
      const first = await decoder.transcribe({ audio, model, language: 'es' });
      const second = await decoder.transcribe({ audio, model, language: 'auto' });
      const language = await decoder.identifyLanguage({ audio, model });

      expect(first.ok && first.value).toEqual({
        language: 'es',
        tokens: [
          { text: ' Hola', fromMs: 100, toMs: 500, probability: 0.9, dtwMs: 120 },
          { text: ' mundo', fromMs: 500, toMs: 1020, probability: 0.8 },
        ],
      });
      expect(second.ok && second.value.language).toBe('es');
      expect(language.ok && language.value).toMatchObject({ language: 'es', probability: 0.82 });
      // LIB1-LANG: the likeliest languages too, for the language decision.
      expect(language.ok && language.value.distribution?.[0]).toEqual({ language: 'es', probability: 0.82 });
      expect(pool.stats()).toEqual({ launches: 1, requests: 3, running: 1 });
      const log = await served(model);
      expect(log.pids).toHaveLength(1);
      expect(log.fields).toEqual([
        { response_format: 'verbose_json', language: 'es', no_language_probabilities: 'true' },
        { response_format: 'verbose_json', language: 'auto', no_language_probabilities: 'false' },
        { response_format: 'verbose_json', detect_language: 'true', language: 'auto' },
      ]);
      expect(fallbacks).toEqual([]);
    } finally {
      await pool.close();
    }
  });

  it('runs requests to one model one at a time, in the order they came', async () => {
    const { pool } = poolWith();
    const decoder = pool.decoder('whisper-server');
    const model = join(dir, 'ggml-tiny.bin');
    try {
      const answers = await Promise.all(
        (['en', 'es', 'pt'] as const).map((language) => decoder.transcribe({ audio, model, language })),
      );
      expect(answers.map((answer) => answer.ok && answer.value.language)).toEqual(['en', 'es', 'pt']);
      expect((await served(model)).fields.map((fields) => fields.language)).toEqual(['en', 'es', 'pt']);
      expect(pool.stats().launches).toBe(1);
    } finally {
      await pool.close();
    }
  });

  it('stops a server nobody asked for a while, and starts one again on the next call', async () => {
    const { pool } = poolWith({ idleMs: 150 });
    const decoder = pool.decoder('whisper-server');
    const model = join(dir, 'ggml-tiny.bin');
    try {
      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      const [pid] = (await served(model)).pids;
      await until(() => pool.stats().running === 0);
      await until(() => !alive(Number(pid)));

      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      expect(pool.stats()).toMatchObject({ launches: 2, running: 1 });
    } finally {
      await pool.close();
    }
  });

  it('runs a request again on a new process when the server dies under it', async () => {
    const { pool } = poolWith();
    const model = join(dir, 'ggml-tiny-crash-once.bin');
    try {
      const answer = await pool.decoder('whisper-server').transcribe({ audio, model, language: 'en' });
      expect(answer.ok).toBe(true);
      expect(pool.stats()).toMatchObject({ launches: 2, requests: 2 });
      expect((await served(model)).pids).toHaveLength(2);
    } finally {
      await pool.close();
    }
  });

  it('starts on the CPU when Metal fails to load, and says so once', async () => {
    const { pool, fallbacks } = poolWith();
    const decoder = pool.decoder('whisper-server');
    const model = join(dir, 'ggml-tiny-gpu-broken.bin');
    try {
      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0]).toMatchObject({
        operation: 'audio.whisper',
        wanted: ['metal'],
        reason: 'accelerator_failed',
      });
      expect(fallbacks[0]?.detail).toContain('MTLDevice');
      expect(pool.stats().launches).toBe(2);
    } finally {
      await pool.close();
    }
  });

  it('starts the CPU build when the CUDA build fails to load (LNX1), once per model', async () => {
    const commands: string[] = [];
    const { pool, fallbacks } = poolWith({
      accelerator: 'cuda',
      cpuBinary: '/c/whisper-server/whisper-server',
      launch: {
        spawn: (request) => {
          commands.push(request.command);
          return fakeSpawn(request);
        },
        fetch,
        freePort: freeLoopbackPort,
        workDir: dir,
        healthIntervalMs: 25,
      },
    });
    const decoder = pool.decoder('/c/whisper-server-cuda/whisper-server');
    const model = join(dir, 'ggml-tiny-gpu-broken.bin');
    try {
      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
      expect(commands).toEqual(['/c/whisper-server-cuda/whisper-server', '/c/whisper-server/whisper-server']);
      expect(fallbacks).toMatchObject([
        { operation: 'audio.whisper', wanted: ['cuda'], reason: 'accelerator_failed' },
      ]);
    } finally {
      await pool.close();
    }
  });

  it('reports a server that found no GPU as a CPU fallback', async () => {
    const { pool, fallbacks } = poolWith();
    const model = join(dir, 'ggml-tiny-no-gpu.bin');
    try {
      expect((await pool.decoder('whisper-server').transcribe({ audio, model, language: 'en' })).ok).toBe(
        true,
      );
      expect(fallbacks.map((event) => event.reason)).toEqual(['no_accelerator']);
    } finally {
      await pool.close();
    }
  });

  it('cancels a request without stopping its server', async () => {
    const { pool } = poolWith();
    const model = join(dir, 'ggml-tiny-slow.bin');
    const controller = new AbortController();
    const progress: number[] = [];
    try {
      const pending = pool.decoder('whisper-server').transcribe({
        audio,
        model,
        language: 'en',
        signal: controller.signal,
        onProgress: (fraction) => progress.push(fraction),
      });
      await until(() => progress.length > 0);
      controller.abort();
      const answer = await pending;

      expect(!answer.ok && answer.error.code).toBe('core.cancelled');
      expect(progress[0]).toBeCloseTo(0.1);
      await until(() => pool.stats().running === 1);
      const [pid] = (await served(model)).pids;
      await until(() => alive(Number(pid)));
      await expect.poll(async () => (await readFile(`${model}.log`, 'utf8')).includes('aborted')).toBe(true);
    } finally {
      await pool.close();
    }
  });

  it('returns EngineUnavailable when the server cannot start, saying why: no file, or one not executable', async () => {
    const pool = createWhisperServerPool({
      launch: { spawn: posixServerSpawn, fetch, freePort: freeLoopbackPort, workDir: dir },
      accelerator: 'metal',
    });
    // UX2 round 6: a whisper-server downloaded without its executable bit read "exited (code null) while loading".
    const notExecutable = join(dir, 'whisper-server');
    await writeFile(notExecutable, '#!/bin/sh\n', { mode: 0o644 });
    try {
      for (const [binary, why] of [
        [join(dir, 'missing-whisper-server'), 'ENOENT'],
        [notExecutable, 'EACCES'],
      ] as const) {
        const answer = await pool
          .decoder(binary)
          .transcribe({ audio, model: join(dir, 'ggml-tiny.bin'), language: 'en' });
        expect(!answer.ok && answer.error.code).toBe('audio.engine_unavailable');
        expect(!answer.ok && answer.error.detail).toBe(`could not start ${binary}: ${why}`);
      }
      expect(pool.stats().running).toBe(0);
    } finally {
      await pool.close();
    }
  });

  it('refuses calls after close, and close stops its servers', async () => {
    const { pool } = poolWith();
    const decoder = pool.decoder('whisper-server');
    const model = join(dir, 'ggml-tiny.bin');
    expect((await decoder.transcribe({ audio, model, language: 'en' })).ok).toBe(true);
    const [pid] = (await served(model)).pids;
    await pool.close();

    expect(alive(Number(pid))).toBe(false);
    const late = await decoder.transcribe({ audio, model, language: 'en' });
    expect(!late.ok && late.error.code).toBe('audio.engine_unavailable');
    // The refusal says why, so a job that meets it names its cause.
    expect(!late.ok && late.error.detail).toMatch(/pool is closed/);
  });

  it('stops servers left behind by an owner that is gone', async () => {
    const registryDir = join(dir, 'servers');
    const deadOwner = 2_147_000_000;
    const isAlive = (pid: number) => pid !== deadOwner && alive(pid);
    const kill = (pid: number) => process.kill(-pid, 'SIGTERM');
    const registry = createServerRegistry({ dir: registryDir, fetch, isAlive, kill });
    const { pool } = poolWith({ registry, ownerPid: deadOwner });
    const model = join(dir, 'ggml-tiny.bin');
    try {
      expect((await pool.decoder('whisper-server').transcribe({ audio, model, language: 'en' })).ok).toBe(
        true,
      );
      const [pid] = (await served(model)).pids;

      const later = createServerRegistry({ dir: registryDir, fetch, isAlive, kill });
      expect(await later.sweep()).toBe(1);
      await until(() => !alive(Number(pid)));
      expect(await later.sweep()).toBe(0);
    } finally {
      await pool.close();
    }
  });

  it('serves even when the launch record cannot be written, and says so', async () => {
    const logs: string[] = [];
    const registry = {
      record: async () => Promise.reject(new Error('disk full')),
      forget: async () => undefined,
      sweep: async () => 0,
    };
    const { pool } = poolWith({ registry, log: (line) => logs.push(line) });
    try {
      const model = join(dir, 'ggml-tiny.bin');
      expect((await pool.decoder('whisper-server').transcribe({ audio, model, language: 'en' })).ok).toBe(
        true,
      );
      expect(logs.join('\n')).toContain('disk full');
    } finally {
      await pool.close();
    }
  });

  it('leaves alone a record whose owner still runs', async () => {
    const registryDir = join(dir, 'servers');
    const kill = (pid: number) => process.kill(-pid, 'SIGTERM');
    const registry = createServerRegistry({ dir: registryDir, fetch, isAlive: alive, kill });
    const { pool } = poolWith({ registry });
    const model = join(dir, 'ggml-tiny.bin');
    try {
      expect((await pool.decoder('whisper-server').transcribe({ audio, model, language: 'en' })).ok).toBe(
        true,
      );
      expect(await registry.sweep()).toBe(0);
      expect(pool.stats().running).toBe(1);
    } finally {
      await pool.close();
    }
  });
});
