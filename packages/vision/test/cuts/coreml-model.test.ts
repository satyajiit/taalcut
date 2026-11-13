// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S10: TransNetV2 on Core ML in the mac helper, with a fake helper (the live one: integration/
 * coreml-shots-parity.test.ts; the helper's own tests: native/mac-helper ShotsTests.swift). The pool is eager: a
 * load starts the helper and opens the model on the compute units asked for, and fails when it won't open, so the
 * app can take the ONNX process instead. A window goes as a file of its rgb24 bytes in the windows folder (removed
 * once answered) and its two heads come back; a failed
 * window ends that helper (the lease's later windows fail, the next job starts another); a cancelled one stops
 * waiting and the helper goes on; idle, the helper is closed.
 */
import { CancelledError, err, ok, type Result, type TaalcutError } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coreMlShotModel, shotsServeArgs, type ShotModelUnits } from '../../src/cuts/coreml-model';
import { WINDOW_FRAMES } from '../../src/cuts/windows';
import { grayWindow, manualTimers, settle } from '../helpers/model-pair';

interface Sent {
  readonly method: string;
  readonly params: JsonValue;
}

type Answer = (method: string, params: JsonValue, signal?: AbortSignal) => Promise<Result<JsonValue>>;

const heads = (value: number): JsonValue => {
  const values = new Float32Array(WINDOW_FRAMES).fill(value);
  const base64 = Buffer.from(values.buffer).toString('base64');
  return { single: base64, manyHot: base64 };
};

const helperError = (code: string): TaalcutError => ({
  code: 'media.sidecar_failed',
  messageKey: 'errors.media.sidecar_failed',
  detail: code,
  params: { helperCode: code },
  retryable: false,
});

let windowsDir = '';
beforeAll(async () => {
  windowsDir = await mkdtemp(join(tmpdir(), 'taalcut-shots-test-'));
});
afterAll(async () => {
  await rm(windowsDir, { recursive: true, force: true });
});

/** A fake helper process: records what it was sent (and the window files' bytes) and answers by `answer`. */
function fakeHelper(answer: Answer) {
  const sent: Sent[] = [];
  const windows: Buffer[] = [];
  let closed = 0;
  const helper: JsonLineSidecar = {
    ready: async () => ok(null),
    async request(method, params, options) {
      const path = typeof params === 'object' && params && 'path' in params ? params.path : undefined;
      if (typeof path === 'string') windows.push(await readFile(path));
      sent.push({ method, params });
      return answer(method, params, options?.signal);
    },
    async close() {
      closed += 1;
    },
  };
  return { helper, sent, windows, closed: () => closed };
}

const working: Answer = async (method) => ok(method === 'shots.prepare' ? { loadMs: 3 } : heads(0.25));

function harness(
  answer: Answer = working,
  units: ShotModelUnits = 'cpuAndGPU',
  dir: string | null = '/c/coreml',
) {
  const timers = manualTimers();
  const helpers: ReturnType<typeof fakeHelper>[] = [];
  const started: string[] = [];
  const model = coreMlShotModel({
    helper: {
      windowsDir: async () => windowsDir,
      start: async (modelsDir, windowsAt) => {
        started.push(modelsDir);
        expect(windowsAt).toBe(windowsDir);
        const fake = fakeHelper(answer);
        helpers.push(fake);
        return ok(fake.helper);
      },
    },
    modelDir: async () => dir,
    units,
    idleMs: 120_000,
    startMs: 30_000,
    timers,
  });
  return { model, timers, helpers, started };
}

describe('coreMlShotModel', () => {
  it('starts the helper at the load, opens the model there, and sends each window as a file of its bytes', async () => {
    const { model, helpers, started } = harness(working, 'cpuAndNeuralEngine');
    const lease = await model.load();
    if (!lease.ok) throw new Error(lease.error.code);
    expect([lease.value.id, lease.value.backend]).toEqual(['transnetv2-coreml', 'coreml']);
    expect(started).toEqual(['/c/coreml']);
    expect(helpers[0]?.sent).toEqual([
      { method: 'shots.prepare', params: { computeUnits: 'cpuAndNeuralEngine' } },
    ]);
    const window = grayWindow([0, 17, 255]);
    const out = await lease.value.predict(window);
    expect(out.ok && [out.value.single.length, out.value.single[0], out.value.manyHot[99]]).toEqual([
      100, 0.25, 0.25,
    ]);
    const request = helpers[0]?.sent[1];
    expect(request?.method).toBe('shots.windows');
    const params = request?.params as { computeUnits: string; count: number; path: string };
    expect([params.computeUnits, params.count]).toEqual(['cpuAndNeuralEngine', 1]);
    expect(params.path.startsWith(join(windowsDir, 'shots-'))).toBe(true);
    const bytes = helpers[0]?.windows[0];
    expect(bytes?.byteLength).toBe(window.length);
    expect(bytes && [bytes[0], bytes[48 * 27 * 3], bytes[2 * 48 * 27 * 3]]).toEqual([0, 17, 255]);
    // Answered, the file is gone.
    expect(await readdir(windowsDir)).toEqual([]);
    // A second job shares the helper.
    const again = await model.load();
    expect(again.ok && started).toEqual(['/c/coreml']);
  });

  it('fails the load without its component or when the model won’t open, so the ONNX process is used', async () => {
    const missing = harness(working, 'cpuAndGPU', null);
    const none = await missing.model.load();
    expect(!none.ok && [none.error.code, none.error.detail]).toEqual([
      'vision.shot_model_failed',
      'transnetv2-coreml is not installed',
    ]);
    expect(missing.started).toEqual([]);
    const broken = harness(async () => err(helperError('shots.model_load_failed')));
    const refused = await broken.model.load();
    expect(!refused.ok && refused.error.code).toBe('vision.shot_model_failed');
    expect(!refused.ok && refused.error.detail).toContain('shots.prepare: shots.model_load_failed');
    expect(broken.helpers[0]?.closed()).toBe(1);
    // The next job asks a new helper.
    await broken.model.load();
    expect(broken.started).toHaveLength(2);
  });

  it('ends a helper whose window fails: the lease’s later windows fail, the next job starts another', async () => {
    let windows = 0;
    const { model, helpers } = harness(async (method) => {
      if (method === 'shots.prepare') return ok({});
      windows += 1;
      return windows === 1 ? err(helperError('shots.failed')) : ok(heads(0.5));
    });
    const lease = await model.load();
    if (!lease.ok) throw new Error(lease.error.code);
    const first = await lease.value.predict(grayWindow([1]));
    expect(!first.ok && first.error.detail).toContain('shots.windows: shots.failed');
    const second = await lease.value.predict(grayWindow([1]));
    expect(!second.ok && second.error.code).toBe('vision.shot_model_failed');
    expect(helpers[0]?.closed()).toBe(1);
    const next = await model.load();
    if (!next.ok) throw new Error(next.error.code);
    expect(helpers).toHaveLength(2);
    const out = await next.value.predict(grayWindow([1]));
    expect(out.ok && out.value.single[0]).toBe(0.5);
  });

  it('stops waiting for a cancelled window and keeps the helper', async () => {
    const { model, helpers } = harness(async (method, _params, signal) => {
      if (method === 'shots.prepare') return ok({});
      return new Promise((resolve) =>
        signal?.addEventListener('abort', () => resolve(err(CancelledError()))),
      );
    });
    const lease = await model.load();
    if (!lease.ok) throw new Error(lease.error.code);
    const cancel = new AbortController();
    const window = lease.value.predict(grayWindow([1]), cancel.signal);
    // Once the window's file is written and sent.
    while (helpers[0]?.sent.length !== 2) await settle(1);
    cancel.abort();
    const out = await window;
    expect(!out.ok && out.error.code).toBe('core.cancelled');
    expect(helpers[0]?.closed()).toBe(0);
    const aborted = new AbortController();
    aborted.abort();
    expect((await model.load(aborted.signal)).ok).toBe(false);
  });

  it('closes the helper after idleMs without a window', async () => {
    const { model, helpers, timers } = harness();
    const lease = await model.load();
    if (!lease.ok) throw new Error(lease.error.code);
    await lease.value.predict(grayWindow([1]));
    timers.advance(119_000);
    expect(helpers[0]?.closed()).toBe(0);
    timers.advance(1_000);
    await settle();
    expect(helpers[0]?.closed()).toBe(1);
    await model.load();
    expect(helpers).toHaveLength(2);
  });

  it('serves the shots service with the model’s folder and reads windows only from the windows folder', () => {
    expect(shotsServeArgs('/c/coreml', '/t/vision')).toEqual([
      'serve',
      '--services',
      'shots',
      '--models',
      '/c/coreml',
      '--allow-root',
      '/t/vision',
    ]);
  });
});
