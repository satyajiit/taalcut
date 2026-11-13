// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** ONNX session choice with a fake runtime. Core ML is never a default. */
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createOnnxRuntime } from '@taalcut/media';

function module(fail: readonly string[] = []) {
  const providers: string[][] = [];
  return {
    providers,
    InferenceSession: {
      async create(
        _model: Uint8Array | string,
        options?: { readonly executionProviders?: readonly string[] },
      ) {
        const chosen = [...(options?.executionProviders ?? [])];
        providers.push(chosen);
        if (chosen.some((name) => fail.includes(name))) throw new Error(`${chosen[0]} unavailable`);
        return {
          async run() {
            return {};
          },
          release() {},
        };
      },
    },
  };
}

describe('createOnnxRuntime', () => {
  it('opens WebGPU first and does not try the CPU', async () => {
    const runtime = module();
    const session = await createOnnxRuntime({ loadModule: async () => runtime }).openSession(
      new Uint8Array(),
      {
        operation: 'vision.embed',
      },
    );
    expect(session.ok && session.value.backend).toBe('webgpu');
    expect(runtime.providers).toEqual([['webgpu']]);
  });

  it('falls back to the CPU with accelerator_failed when WebGPU cannot be created', async () => {
    const events: ComputeFallbackEvent[] = [];
    const runtime = module(['webgpu']);
    const session = await createOnnxRuntime({
      loadModule: async () => runtime,
      onComputeFallback: (event) => events.push(event),
    }).openSession(new Uint8Array(), { operation: 'vision.embed' });
    expect(session.ok && session.value.backend).toBe('cpu');
    expect(runtime.providers).toEqual([['webgpu'], ['cpu']]);
    expect(events.map((event) => event.reason)).toEqual(['accelerator_failed']);
    expect(runtime.providers.flat()).not.toContain('coreml');
  });

  it("names DirectML the way onnxruntime does ('dml')", async () => {
    const runtime = module();
    const session = await createOnnxRuntime({ loadModule: async () => runtime }).openSession('model.onnx', {
      operation: 'vision.ocr',
      candidates: ['directml', 'webgpu', 'cpu'],
    });
    expect(session.ok && session.value.backend).toBe('directml');
    expect(runtime.providers).toEqual([['dml']]);
  });

  it('does not invent a CPU session when cpu is not a candidate', async () => {
    const runtime = module(['webgpu']);
    const session = await createOnnxRuntime({ loadModule: async () => runtime }).openSession(
      new Uint8Array(),
      {
        operation: 'vision.embed',
        candidates: ['webgpu'],
      },
    );
    expect(session.ok).toBe(false);
    if (session.ok) return;
    expect(session.error.code).toBe('media.onnx_failed');
  });

  it('passes the session names through, and says why the CPU when no accelerator was offered', async () => {
    const events: ComputeFallbackEvent[] = [];
    const runtime = module();
    const session = await createOnnxRuntime({
      loadModule: async () => runtime,
      onComputeFallback: (event) => events.push(event),
    }).openSession('model.onnx', {
      operation: 'vision.ocr',
      candidates: ['cpu'],
      cpuReason: { reason: 'no_accelerator', detail: 'no WebGPU execution provider' },
    });
    expect(session.ok && session.value.backend).toBe('cpu');
    expect(session.ok && session.value.inputNames).toEqual([]);
    expect(events.map((event) => [event.reason, event.detail])).toEqual([
      ['no_accelerator', 'no WebGPU execution provider'],
    ]);
  });

  it('reports the module as unavailable when it cannot be loaded', async () => {
    const session = await createOnnxRuntime({
      loadModule: async () => {
        throw new Error('missing');
      },
    }).openSession('model.onnx', { operation: 'audio.embed' });
    expect(session.ok).toBe(false);
    if (session.ok) return;
    expect(session.error.code).toBe('media.onnx_unavailable');
  });
});
