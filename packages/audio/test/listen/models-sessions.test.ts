// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F4 sessions: a fake onnxruntime module (no model files, no GPU). A WebGPU that can't open logs exactly one
 * `compute.fallback` per operation, `accelerator_failed`, however often the model runs; the 8 GB rule keeps one model
 * open; an idle model is released after 60 s on an injected clock; a missing build names its component.
 */
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createAstTagger } from '../../src/listen/models/ast';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import {
  directoryListenFiles,
  LISTEN_COMPONENTS,
  type ListenModelFiles,
} from '../../src/listen/models/files';
import type { ListenOrt } from '../../src/listen/models/ort';
import { createListenSessions, type ListenTimers } from '../../src/listen/models/sessions';

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array,
    readonly dims: readonly number[],
  ) {}
  dispose(): void {}
}

interface Log {
  readonly opened: string[];
  readonly released: string[];
}

/** Model files are strings, the front-end graphs bytes; `failing` providers throw on create. */
function fakeOrt(failing: readonly string[], log: Log): ListenOrt {
  return {
    Tensor: FakeTensor as unknown as ListenOrt['Tensor'],
    InferenceSession: {
      async create(model, options) {
        const provider = options?.executionProviders?.[0];
        const name = typeof provider === 'string' ? provider : (provider?.name ?? 'cpu');
        if (failing.includes(name)) throw new Error(`${name}: no adapter`);
        const label = `${typeof model === 'string' ? model.split('/').at(-2) : 'graph'}@${name}`;
        log.opened.push(label);
        return {
          outputNames: ['out'],
          async run(feeds: Readonly<Record<string, unknown>>) {
            const first = Object.values(feeds)[0] as FakeTensor;
            const batch = first.dims[0] ?? 1;
            if ('frames' in feeds) return { out: { data: new Float32Array(batch * 128) } };
            if ('input_values' in feeds) return { logits: { data: new Float32Array(batch * 527) } };
            return { audio_embeds: { data: new Float32Array(batch * 512).fill(1) } };
          },
          async release() {
            log.released.push(label);
          },
        };
      },
    },
  };
}

const files: ListenModelFiles = {
  async resolve(name) {
    const id = `${LISTEN_COMPONENTS[name]}-fp16`;
    return ok({
      name,
      componentId: id,
      dir: `/models/${id}`,
      modelPath: `/models/${id}/model.onnx`,
      dtype: 'fp16',
    });
  },
};

function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const timers: ListenTimers = {
    set(run, ms) {
      pending.set(++next, { run, ms });
      return next;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    pending,
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) timer.run();
    },
  };
}

const second = () => new Float32Array(48_000).fill(0.1);

describe('listen sessions', () => {
  it('a WebGPU failure logs exactly one compute.fallback, accelerator_failed, however many runs', async () => {
    const events: ComputeFallbackEvent[] = [];
    const log: Log = { opened: [], released: [] };
    const sessions = createListenSessions({
      files,
      loadModule: async () => fakeOrt(['webgpu'], log),
      onFallback: (event) => events.push(event),
    });
    const input = { type: 'float32' as const, data: new Float32Array(1001 * 64), dims: [1, 1, 1001, 64] };
    for (let i = 0; i < 3; i++) {
      const ran = await sessions.run('clapAudio', { input_features: input });
      expect(ran.ok).toBe(true);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'listen.clap.audio',
      reason: 'accelerator_failed',
      wanted: ['webgpu'],
    });
    expect(sessions.backend('clapAudio')).toBe('cpu');
  });

  it('the front end falls back to the oracle once, and the model logs its own', async () => {
    const events: ComputeFallbackEvent[] = [];
    const sessions = createListenSessions({
      files,
      loadModule: async () => fakeOrt(['webgpu'], { opened: [], released: [] }),
      onFallback: (event) => events.push(event),
    });
    const clap = createClapAudio(sessions);
    for (let i = 0; i < 2; i++) expect((await clap.embedSegments([second(), second()])).ok).toBe(true);
    const operations = events.map((event) => event.operation).sort();
    expect(operations).toEqual(['listen.clap.audio', 'listen.frontend']);
    expect(events.every((event) => event.reason === 'accelerator_failed')).toBe(true);
  });

  it('on WebGPU nothing is logged and both the graph and the model run there', async () => {
    const events: ComputeFallbackEvent[] = [];
    const log: Log = { opened: [], released: [] };
    const sessions = createListenSessions({
      files,
      loadModule: async () => fakeOrt([], log),
      onFallback: (event) => events.push(event),
    });
    const clap = createClapAudio(sessions);
    const embedded = await clap.embedSegments([second()]);
    expect(embedded.ok && embedded.value[0]?.length).toBe(512);
    expect(events).toEqual([]);
    expect(log.opened).toEqual(['graph@webgpu', 'clap-general-audio-fp16@webgpu']);
  });

  it('a forced CPU plan logs `disabled` once and opens the CPU directly', async () => {
    const events: ComputeFallbackEvent[] = [];
    const sessions = createListenSessions({
      files,
      loadModule: async () => fakeOrt([], { opened: [], released: [] }),
      onFallback: (event) => events.push(event),
      plan: async () => ({
        devices: ['cpu'],
        cpuReason: { reason: 'disabled', detail: 'TAALCUT_FORCE_CPU', wanted: ['webgpu'] },
      }),
    });
    const ast = createAstTagger(sessions);
    for (let i = 0; i < 2; i++) expect((await ast.probs([second()])).ok).toBe(true);
    expect(events.map((event) => [event.operation, event.reason])).toEqual([
      ['listen.frontend', 'disabled'],
      ['listen.ast', 'disabled'],
    ]);
  });

  it('keeps one model open on a small machine', async () => {
    const log: Log = { opened: [], released: [] };
    const sessions = createListenSessions({
      files,
      singleResident: true,
      loadModule: async () => fakeOrt([], log),
    });
    await createClapAudio(sessions).embedSegments([second()]);
    expect(sessions.resident()).toEqual(['clapAudio']);
    await createAstTagger(sessions).probs([second()]);
    expect(sessions.resident()).toEqual(['ast']);
    expect(log.released).toContain('clap-general-audio-fp16@webgpu');
  });

  it('keeps several open otherwise', async () => {
    const sessions = createListenSessions({
      files,
      loadModule: async () => fakeOrt([], { opened: [], released: [] }),
    });
    await createClapAudio(sessions).embedSegments([second()]);
    await createAstTagger(sessions).probs([second()]);
    expect([...sessions.resident()].sort()).toEqual(['ast', 'clapAudio']);
  });

  it('releases a model nobody ran for 60 s', async () => {
    const clock = manualTimers();
    const log: Log = { opened: [], released: [] };
    const sessions = createListenSessions({
      files,
      timers: clock.timers,
      loadModule: async () => fakeOrt([], log),
    });
    await createClapAudio(sessions).embedSegments([second()]);
    expect([...clock.pending.values()].every((timer) => timer.ms === 60_000)).toBe(true);
    expect(sessions.resident()).toEqual(['clapAudio']);
    clock.fire();
    await sessions.release();
    expect(sessions.resident()).toEqual([]);
    expect(log.released).toEqual(expect.arrayContaining(['clap-general-audio-fp16@webgpu', 'graph@webgpu']));
  });

  it('a run re-arms the idle timer instead of stacking another', async () => {
    const clock = manualTimers();
    const sessions = createListenSessions({
      files,
      timers: clock.timers,
      loadModule: async () => fakeOrt([], { opened: [], released: [] }),
    });
    const clap = createClapAudio(sessions);
    await clap.embedSegments([second()]);
    await clap.embedSegments([second()]);
    expect(clock.pending.size).toBe(2);
  });

  it('a missing build fails with audio.listen_model_missing naming the component', async () => {
    const sessions = createListenSessions({
      files: directoryListenFiles('/nowhere', 'int8'),
      loadModule: async () => fakeOrt([], { opened: [], released: [] }),
    });
    const ran = await createClapAudio(sessions).embedSegments([second()]);
    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe('audio.listen_model_missing');
      expect(ran.error.params).toEqual({ component: 'clap-general-audio' });
    }
  });

  it('no onnxruntime: audio.listen_unavailable, and the front end logs no_accelerator once', async () => {
    const events: ComputeFallbackEvent[] = [];
    const sessions = createListenSessions({
      files,
      loadModule: async () => {
        throw new Error('Cannot find module onnxruntime-node');
      },
      onFallback: (event) => events.push(event),
    });
    const ran = await createClapAudio(sessions).embedSegments([second()]);
    expect(!ran.ok && ran.error.code).toBe('audio.listen_unavailable');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'listen.frontend', reason: 'no_accelerator' });
  });
});
