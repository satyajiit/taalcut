// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1 sessions: a component update (which deletes the old version's folder) is what the next open reads, after
 * an idle release or once a lookup finds the new build; `installedOnly()` never installs, at lookup or at run time;
 * `compute.fallback` is reported once per operation however often a model reopens on the CPU; an idle release that
 * fails is logged, never an unhandled rejection. And `installedListenFiles` with the machine's chooser counts only
 * the build this machine runs as installed.
 */
import { err, NotFoundError, ok, type ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createAstTagger } from '../../src/listen/models/ast';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import {
  installedListenFiles,
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
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

/** Opens a model path only when `exists` says it is on disk; `failing` providers throw; `release` may throw. */
function fakeOrt(options: {
  opened: string[];
  exists?: (path: string) => boolean;
  failing?: readonly string[];
  releaseFails?: boolean;
}): ListenOrt {
  return {
    Tensor: FakeTensor as unknown as ListenOrt['Tensor'],
    InferenceSession: {
      async create(model, sessionOptions) {
        const provider = sessionOptions?.executionProviders?.[0];
        const name = typeof provider === 'string' ? provider : (provider?.name ?? 'cpu');
        if (options.failing?.includes(name)) throw new Error(`${name}: no adapter`);
        if (typeof model === 'string') {
          if (options.exists && !options.exists(model)) throw new Error(`ENOENT: ${model}`);
          options.opened.push(model);
        }
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
            if (options.releaseFails && typeof model === 'string') throw new Error('release failed');
          },
        };
      },
    },
  };
}

function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: ListenTimers = {
    set: (run) => (pending.set(++next, run), next),
    clear: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const run of due) run();
    },
  };
}

/** The component manager's folders: `<id>/<version>/model.onnx`; `installs` counts every install asked. */
function versionedFiles(state: { version: string; installs: number; installed: boolean }): ListenModelFiles {
  const build = (name: ListenModelName) => {
    const id = `${LISTEN_COMPONENTS[name]}-fp16`;
    const dir = `/c/${id}/${state.version}`;
    return { name, componentId: id, dir, modelPath: `${dir}/model.onnx`, dtype: 'fp16' as const };
  };
  return {
    async resolve(name) {
      state.installs++;
      state.installed = true;
      return ok(build(name));
    },
    installed: async (name) => (state.installed ? build(name) : undefined),
  };
}

const input = {
  input_features: { type: 'float32' as const, data: new Float32Array(1001 * 64), dims: [1, 1, 1001, 64] },
};
const second = () => new Float32Array(48_000).fill(0.1);

describe('listen sessions after EAR1-R1', () => {
  it('after an update deletes the old folder, the reopen after an idle release reads the new build', async () => {
    const state = { version: 'v1', installs: 0, installed: true };
    const opened: string[] = [];
    const events: ComputeFallbackEvent[] = [];
    const clock = manualTimers();
    const sessions = createListenSessions({
      files: versionedFiles(state),
      timers: clock.timers,
      loadModule: async () => fakeOrt({ opened, exists: (path) => path.includes(`/${state.version}/`) }),
      onFallback: (event) => events.push(event),
    });
    expect((await sessions.run('clapAudio', input)).ok).toBe(true);
    state.version = 'v2';
    clock.fire();
    await sessions.release();
    const again = await sessions.run('clapAudio', input);
    expect(again.ok).toBe(true);
    expect(opened).toEqual([
      '/c/clap-general-audio-fp16/v1/model.onnx',
      '/c/clap-general-audio-fp16/v2/model.onnx',
    ]);
    // No false fallback: the deleted path was never tried on the GPU and then the CPU.
    expect(events).toEqual([]);
  });

  it('model() looks the build up per call, and an open model from the old build is reopened from the new', async () => {
    const state = { version: 'v1', installs: 0, installed: true };
    const opened: string[] = [];
    const sessions = createListenSessions({
      files: versionedFiles(state),
      loadModule: async () => fakeOrt({ opened }),
    });
    expect((await sessions.run('clapAudio', input)).ok).toBe(true);
    state.version = 'v2';
    const looked = await sessions.model('clapAudio');
    expect(looked.ok && looked.value.dir).toBe('/c/clap-general-audio-fp16/v2');
    expect((await sessions.run('clapAudio', input)).ok).toBe(true);
    expect(opened.at(-1)).toBe('/c/clap-general-audio-fp16/v2/model.onnx');
    expect(sessions.resident()).toEqual(['clapAudio']);
  });

  it('installedOnly() never installs: not at lookup, not at run time', async () => {
    const state = { version: 'v1', installs: 0, installed: false };
    const sessions = createListenSessions({
      files: versionedFiles(state),
      loadModule: async () => fakeOrt({ opened: [] }),
    });
    const local = sessions.installedOnly();
    const looked = await local.model('ast');
    expect(!looked.ok && looked.error.params).toEqual({ component: 'ast-audioset' });
    const ran = await createClapAudio(local).embedSegments([second()]);
    expect(!ran.ok && ran.error.code).toBe('audio.listen_model_missing');
    expect(state.installs).toBe(0);
    // Installed by someone else: the same view now runs it, sharing the open model with the installing sessions.
    state.installed = true;
    expect((await createClapAudio(local).embedSegments([second()])).ok).toBe(true);
    expect(sessions.resident()).toEqual(['clapAudio']);
    expect(state.installs).toBe(0);
  });

  it('on 8 GB, CLAP and AST taking turns on the CPU report one compute.fallback per operation', async () => {
    const events: ComputeFallbackEvent[] = [];
    const state = { version: 'v1', installs: 0, installed: true };
    const sessions = createListenSessions({
      files: versionedFiles(state),
      singleResident: true,
      loadModule: async () => fakeOrt({ opened: [], failing: ['webgpu'] }),
      onFallback: (event) => events.push(event),
    });
    const clap = createClapAudio(sessions);
    const ast = createAstTagger(sessions);
    for (let i = 0; i < 3; i++) {
      expect((await clap.embedSegments([second()])).ok).toBe(true);
      expect((await ast.probs([second()])).ok).toBe(true);
    }
    expect(events.map((event) => event.operation).sort()).toEqual([
      'listen.ast',
      'listen.clap.audio',
      'listen.frontend',
    ]);
  });

  it('an idle release that fails is logged, not left as an unhandled rejection', async () => {
    const lines: string[] = [];
    const clock = manualTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const state = { version: 'v1', installs: 0, installed: true };
      const sessions = createListenSessions({
        files: versionedFiles(state),
        timers: clock.timers,
        log: (line) => lines.push(line),
        loadModule: async () => fakeOrt({ opened: [], releaseFails: true }),
      });
      expect((await sessions.run('clapAudio', input)).ok).toBe(true);
      clock.fire();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(lines).toEqual([expect.stringMatching(/idle release of clapAudio failed: release failed/)]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('installedListenFiles with the machine’s chooser', () => {
  const ref = (id: string) => ({ id, version: '1', path: `/c/${id}/1`, notice: '' });
  const manager = (onDisk: readonly string[]) => ({
    installs: [] as string[],
    async install(id: string) {
      this.installs.push(id);
      return onDisk.includes(id) ? ok(ref(id)) : err(NotFoundError({ entity: 'component', id }));
    },
    get: async (id: string) => (onDisk.includes(id) ? ref(id) : undefined),
  });
  const metal = async (id: string) => ok(`${id}-fp16`);

  it('counts only the build this machine runs: int8 on disk on a Metal Mac is not installed', async () => {
    const components = manager(['clap-general-audio']);
    const files = installedListenFiles(components, { variantOf: metal });
    expect(await files.installed?.('clapAudio')).toBeUndefined();
    expect(components.installs).toEqual([]);
    const both = installedListenFiles(manager(['clap-general-audio', 'clap-general-audio-fp16']), {
      variantOf: metal,
    });
    expect((await both.installed?.('clapAudio'))?.componentId).toBe('clap-general-audio-fp16');
  });

  it('without a chooser, either build (fp16 first), as before', async () => {
    const files = installedListenFiles(manager(['clap-general-audio']));
    expect((await files.installed?.('clapAudio'))?.componentId).toBe('clap-general-audio');
  });
});
