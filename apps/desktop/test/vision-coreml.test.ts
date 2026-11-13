// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's Core ML embedder backend (IX2-E5), with a fake helper: what it needs (helper, both
 * components), the background first load that `available` waits for only briefly, the helper it warmed handed to the
 * model, a failed load logged once, and `onAvailable` when a slow first compile finishes; a component packed with a
 * recipe (IX3-N3) loaded from the folder its weights were written to.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { SidecarFailed, SidecarNotFound, type JsonLineSidecar, type JsonValue } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { coreMlEmbedBackend, yieldFirst, type CoreMlBackendDeps } from '../src/utility/roots/vision-coreml';

const CONFIG = { packaged: false, resourcesPath: '/r' };

interface Fake {
  readonly opened: { args: readonly string[] }[];
  readonly requests: string[];
  release(): void;
}

/** A helper whose `embed.prepare` answers after `release()` (or at once), failing when asked to. */
function fakeOpen(options: { held?: boolean; fail?: boolean } = {}) {
  const opened: { args: readonly string[] }[] = [];
  const requests: string[] = [];
  let release: () => void = () => {};
  const gate = options.held ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  const open = (sidecar: { args?: readonly string[] }): JsonLineSidecar & { onEvent: () => () => void } => {
    opened.push({ args: sidecar.args ?? [] });
    return {
      ready: async () => ok({}),
      async request(method): AsyncResult<JsonValue> {
        requests.push(method);
        if (method === 'embed.prepare') {
          await gate;
          if (options.fail) return err(SidecarFailed({ helperCode: 'embed.model_load_failed' }));
        }
        return ok({ loadMs: 1 });
      },
      close: async () => {},
      onEvent: () => () => {},
    };
  };
  const fake: Fake = { opened, requests, release: () => release() };
  return { open, fake };
}

function backend(
  open: ReturnType<typeof fakeOpen>['open'],
  installed: readonly string[],
  helperFound = true,
  waitMs = 50,
  modelsDir?: CoreMlBackendDeps['modelsDir'],
  first?: Pick<CoreMlBackendDeps, 'yieldTo' | 'yieldMaxMs'>,
) {
  const lines: string[] = [];
  const coreml = coreMlEmbedBackend({
    ...(modelsDir ? { modelsDir } : {}),
    ...first,
    config: CONFIG,
    installed: async (id) => (installed.includes(id) ? `/components/${id}` : null),
    tempDir: async () => '/tmp/frames',
    log: (line) => lines.push(line),
    waitMs,
    resolver: {
      resolve: async () =>
        helperFound
          ? ok({ path: '/bin/taalcut-mac-helper', source: 'dev-build' as const })
          : err(SidecarNotFound({ binary: 'taalcut-mac-helper' })),
    },
    open,
  });
  return { coreml, lines };
}

const BOTH = ['embeddinggemma-2', 'embeddinggemma-2-coreml'];

describe('coreMlEmbedBackend', () => {
  it('needs the helper and both components, and says which is missing once', async () => {
    const { open, fake } = fakeOpen();
    const noCoreMl = backend(open, ['embeddinggemma-2']);
    expect(await noCoreMl.coreml.available()).toBe(false);
    expect(await noCoreMl.coreml.available()).toBe(false);
    expect(noCoreMl.lines).toEqual([
      '[vision] Core ML embedder: embeddinggemma-2-coreml is not installed; ONNX Runtime instead',
    ]);
    await expect(noCoreMl.coreml.load()).rejects.toThrow(/not installed/);
    const noHelper = backend(open, BOTH, false);
    expect(await noHelper.coreml.available()).toBe(false);
    expect(noHelper.lines[0]).toMatch(/the mac helper is unavailable \(media\.sidecar_not_found\)/);
    expect(fake.opened).toEqual([]);
  });

  it('is available once its first load is done, over the component and the frame folder', async () => {
    const { open, fake } = fakeOpen();
    const { coreml, lines } = backend(open, BOTH);
    expect(await coreml.available()).toBe(true);
    expect(fake.opened[0]?.args).toEqual([
      'serve',
      '--services',
      'embed',
      '--models',
      '/components/embeddinggemma-2-coreml',
      '--allow-root',
      '/tmp/frames',
    ]);
    expect(lines[0]).toMatch(/^\[vision\] Core ML embedder loaded in /);
    expect(fake.requests).toEqual(['embed.prepare']);
  });

  it('says no while a first compile runs, then tells the embedder when it is done', async () => {
    const { open, fake } = fakeOpen({ held: true });
    const { coreml, lines } = backend(open, BOTH);
    let told = 0;
    coreml.onAvailable?.(() => told++);
    expect(await coreml.available()).toBe(false);
    expect(lines).toEqual([
      '[vision] Core ML embedder compiling for this Mac: ONNX Runtime until it is ready',
    ]);
    expect(told).toBe(0);
    fake.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(told).toBe(1);
    expect(await coreml.available()).toBe(true);
    // One load for the whole process.
    expect(fake.requests).toEqual(['embed.prepare']);
  });

  it('logs a load that fails and stays on ONNX Runtime', async () => {
    const { open, fake } = fakeOpen({ fail: true });
    const { coreml, lines } = backend(open, BOTH);
    expect(await coreml.available()).toBe(false);
    expect(await coreml.available()).toBe(false);
    expect(lines).toEqual([
      "[vision] the Core ML embedder won't load (embed.model_load_failed): ONNX Runtime instead",
    ]);
    expect(fake.requests).toEqual(['embed.prepare']);
  });
});

describe("the person's OCR compiles first (FIX-OCRCOLD)", () => {
  const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

  it("starts the first load only once the OCR helper's warm-up is done", async () => {
    let ocrDone: () => void = () => {};
    const ocr = new Promise<void>((resolve) => (ocrDone = resolve));
    const { open, fake } = fakeOpen();
    const { coreml, lines } = backend(open, BOTH, true, 30, undefined, { yieldTo: () => ocr });
    let told = 0;
    coreml.onAvailable?.(() => told++);
    // While OCR compiles, no embed process is started: embeddings stay on ONNX Runtime.
    expect(await coreml.available()).toBe(false);
    await settle(50);
    expect(fake.opened).toEqual([]);
    ocrDone();
    await settle();
    expect(fake.requests).toEqual(['embed.prepare']);
    expect(told).toBe(1);
    expect(lines[1]).toMatch(
      /^\[vision\] Core ML embedder: first load after OCR's warm-up \(waited 0\.\d s\)$/,
    );
    expect(await coreml.available()).toBe(true);
  });

  it('goes ahead when the warm-up fails or outlasts its cap', async () => {
    const failed = fakeOpen();
    const early = backend(failed.open, BOTH, true, 200, undefined, {
      yieldTo: () => Promise.reject(new Error('no helper')),
    });
    expect(await early.coreml.available()).toBe(true);
    const stuck = fakeOpen();
    const late = backend(stuck.open, BOTH, true, 30, undefined, {
      yieldTo: () => new Promise(() => {}),
      yieldMaxMs: 60,
    });
    expect(await late.coreml.available()).toBe(false);
    expect(stuck.fake.opened).toEqual([]);
    await settle(80);
    expect(stuck.fake.requests).toEqual(['embed.prepare']);
  });

  it('yieldFirst waits for the first work however it ends, at most the cap', async () => {
    expect(await yieldFirst(undefined, 1000)).toBe(0);
    const order: string[] = [];
    await yieldFirst(async () => {
      await settle(20);
      order.push('ocr');
    }, 1000);
    order.push('embed');
    expect(order).toEqual(['ocr', 'embed']);
    const capped = await yieldFirst(() => new Promise(() => {}), 40);
    expect(capped).toBeGreaterThanOrEqual(35);
    expect(capped).toBeLessThan(1000);
  });
});

describe('a component packed with a recipe', () => {
  it('loads a recipe component from the folder its weights were written to, written once and logged', async () => {
    const { open, fake } = fakeOpen();
    const asked: string[] = [];
    const modelsDir: NonNullable<CoreMlBackendDeps['modelsDir']> = async (component, onnx, onWritten) => {
      asked.push(`${component} ${onnx}`);
      const dir = `${component}/expanded`;
      onWritten?.({
        dir,
        ms: 1400,
        files: [{ path: 'T.mlmodelc/weights/weight.bin', bytes: 2e6, sha256: 'c'.repeat(64) }],
      });
      return ok(dir);
    };
    const { coreml, lines } = backend(open, BOTH, true, 50, modelsDir);
    expect(await coreml.available()).toBe(true);
    expect(await coreml.available()).toBe(true);
    expect(fake.opened[0]?.args.slice(3, 5)).toEqual([
      '--models',
      '/components/embeddinggemma-2-coreml/expanded',
    ]);
    expect(asked).toEqual(['/components/embeddinggemma-2-coreml /components/embeddinggemma-2']);
    expect(lines[0]).toBe(
      '[vision] Core ML weights written from the recipe into /components/embeddinggemma-2-coreml/expanded in 1400 ms (2.0 MB): T.mlmodelc/weights/weight.bin sha256 cccccccccccc ok',
    );
  });

  it('stays on ONNX Runtime when the weights cannot be written, and tries again on the next look', async () => {
    const { open, fake } = fakeOpen();
    let calls = 0;
    const modelsDir = async (): AsyncResult<string, string> => {
      calls += 1;
      return err('0.70 GB needed to write the Core ML weights, 0.10 GB free');
    };
    const { coreml, lines } = backend(open, BOTH, true, 50, modelsDir);
    expect(await coreml.available()).toBe(false);
    expect(await coreml.available()).toBe(false);
    expect(lines).toEqual([
      '[vision] Core ML embedder: its weights could not be written (0.70 GB needed to write the Core ML weights, 0.10 GB free); ONNX Runtime instead',
    ]);
    expect(calls).toBe(2);
    expect(fake.opened).toEqual([]);
  });
});
