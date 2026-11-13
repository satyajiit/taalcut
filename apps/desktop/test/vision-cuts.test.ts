// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4, IX2-S2, IX2-S10: the jobs process's shot-boundary model, in a process of its own (roots/vision-cuts.ts
 * says why). On a Mac, Core ML in the helper first; where it won't open (no helper, no `transnetv2-coreml`, the model
 * refused), the ONNX process, said once. Where nothing can fork one the model fails to load (scdet decides, logged by
 * vision). A missing component is the model failing to open, so shots fall back, and is looked up again at the next
 * job. A model process is asked for only at a job's first window, and windows go to it.
 */
import { err, ok, type Result } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { desktopBoundaryModel } from '../src/utility/roots/vision-cuts';

describe('the jobs process’s shot model', () => {
  it('fails where no model process can be started, so scdet decides', async () => {
    const load = desktopBoundaryModel({
      installed: async () => '/m',
      onFallback: () => undefined,
      start: undefined,
    });
    const model = await load();
    expect(!model.ok && [model.error.code, model.error.detail]).toEqual([
      'vision.shot_model_failed',
      'no shot model process in this process',
    ]);
  });

  it('is not there without its component, and is looked up again at the next job', async () => {
    let lookups = 0;
    let starts = 0;
    const load = desktopBoundaryModel({
      installed: async () => {
        lookups += 1;
        return null;
      },
      onFallback: () => undefined,
      start: async () => {
        starts += 1;
        throw new Error('not reached');
      },
    });
    const model = await load();
    expect(!model.ok && [model.error.code, model.error.detail]).toEqual([
      'vision.shot_model_failed',
      'transnetv2 is not installed',
    ]);
    await load();
    expect([lookups, starts]).toEqual([2, 0]);
  });

  it('asks for a model process at the first window and opens TransNetV2 from its component there', async () => {
    const sent: unknown[] = [];
    const load = desktopBoundaryModel({
      installed: async (id) => `/components/${id}`,
      onFallback: () => undefined,
      platform: 'darwin',
      start: async () =>
        ok({
          send: (message) => sent.push(message),
          onMessage: () => undefined,
          onGone: () => undefined,
          close: () => undefined,
        }),
    });
    const model = await load();
    if (!model.ok) throw new Error(model.error.code);
    expect([model.value.id, model.value.backend, sent]).toEqual(['transnetv2', 'webgpu', []]);
    const cancel = new AbortController();
    const window = model.value.predict(new Float32Array(100 * 48 * 27 * 3), cancel.signal);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent).toEqual([{ type: 'open', modelDir: '/components/transnetv2' }]);
    cancel.abort();
    const out = await window;
    expect(!out.ok && out.error.code).toBe('core.cancelled');
  });

  it('opens TransNetV2 on the devices the probe allows: no CUDA on a Linux PC without it', async () => {
    const sent: unknown[] = [];
    const load = desktopBoundaryModel({
      installed: async (id) => `/components/${id}`,
      onFallback: () => undefined,
      platform: 'linux',
      accelerators: async () => ({ platform: 'linux', apis: ['vulkan'], vendor: 'amd', forcedCpu: false }),
      start: async () =>
        ok({
          send: (message) => sent.push(message),
          onMessage: () => undefined,
          onGone: () => undefined,
          close: () => undefined,
        }),
    });
    const model = await load();
    if (!model.ok) throw new Error(model.error.code);
    const cancel = new AbortController();
    const window = model.value.predict(new Float32Array(100 * 48 * 27 * 3), cancel.signal);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent).toEqual([{ type: 'open', modelDir: '/components/transnetv2', devices: ['webgpu', 'cpu'] }]);
    cancel.abort();
    await window;
  });

  describe('on a Mac with the helper', () => {
    function helper(answer: (method: string) => Result<JsonValue>) {
      const asked: string[] = [];
      const started: string[] = [];
      const start = async (modelsDir: string, windowsDir: string) => {
        started.push(`${modelsDir} ${windowsDir}`);
        const sidecar: JsonLineSidecar = {
          ready: async () => ok(null),
          request: async (method) => {
            asked.push(method);
            return answer(method);
          },
          close: async () => undefined,
        };
        return ok(sidecar);
      };
      return { shots: { windowsDir: async () => '/tmp/v', start }, asked, started };
    }
    const onnxStart = () => {
      const starts: number[] = [];
      const start = async () => {
        starts.push(1);
        return ok({
          send: () => undefined,
          onMessage: () => undefined,
          onGone: () => undefined,
          close: () => undefined,
        });
      };
      return { start, starts };
    };

    it('opens TransNetV2 on Core ML from transnetv2-coreml, on the GPU, before any ONNX process', async () => {
      const coreml = helper(() => ok({}));
      const onnx = onnxStart();
      const load = desktopBoundaryModel({
        installed: async (id) => `/components/${id}`,
        onFallback: () => undefined,
        platform: 'darwin',
        start: onnx.start,
        helper: coreml.shots,
      });
      const model = await load();
      if (!model.ok) throw new Error(model.error.code);
      expect([model.value.id, model.value.backend]).toEqual(['transnetv2-coreml', 'coreml']);
      expect([coreml.started, coreml.asked, onnx.starts]).toEqual([
        ['/components/transnetv2-coreml /tmp/v'],
        ['shots.prepare'],
        [],
      ]);
    });

    it('takes the ONNX process when Core ML won’t open, and says why once', async () => {
      const refused = helper(() =>
        err({
          code: 'media.sidecar_failed',
          messageKey: 'x',
          retryable: false,
          params: { helperCode: 'shots.model_load_failed' },
        }),
      );
      const lines: string[] = [];
      const load = desktopBoundaryModel({
        installed: async (id) =>
          id === 'transnetv2-coreml' ? '/components/transnetv2-coreml' : `/components/${id}`,
        onFallback: () => undefined,
        platform: 'darwin',
        start: onnxStart().start,
        helper: refused.shots,
        log: (line) => lines.push(line),
      });
      const [first, second] = [await load(), await load()];
      expect(first.ok && [first.value.id, first.value.backend]).toEqual(['transnetv2', 'webgpu']);
      expect(second.ok && second.value.id).toBe('transnetv2');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('shots.prepare: shots.model_load_failed');
      expect(lines[0]).toContain('ONNX Runtime instead');
    });

    it('takes the ONNX process without the Core ML component, and never on another platform', async () => {
      const coreml = helper(() => ok({}));
      const without = desktopBoundaryModel({
        installed: async (id) => (id === 'transnetv2-coreml' ? null : `/components/${id}`),
        onFallback: () => undefined,
        platform: 'darwin',
        start: onnxStart().start,
        helper: coreml.shots,
      });
      const model = await without();
      expect(model.ok && model.value.id).toBe('transnetv2');
      const linux = desktopBoundaryModel({
        installed: async (id) => `/components/${id}`,
        onFallback: () => undefined,
        platform: 'linux',
        start: onnxStart().start,
        helper: coreml.shots,
      });
      const there = await linux();
      expect(there.ok && [there.value.id, there.value.backend]).toEqual(['transnetv2', 'cuda']);
      expect(coreml.started).toEqual([]);
    });
  });
});
