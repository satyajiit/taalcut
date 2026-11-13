// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1's analysis rig: the listen service's own model set (installing sessions and their installed-only view)
 * over a fake component manager that tells what is on disk from what this machine picks, a fake onnxruntime, the
 * DSP on its f64 oracle, and an in-memory derived cache.
 */
import { err, ok, type AsyncResult, type SoundCritique, type SoundRealness } from '@taalcut/core';
import type { ListenAnalysisDeps } from '../../src/listen/analysis/analyse';
import { createListenAnalysisCache } from '../../src/listen/analysis/cache';
import type { CritiqueInput, ListenPassInput } from '../../src/listen/analysis/hooks';
import type { ListenModelSet } from '../../src/listen/analysis/plan';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { createListenModels } from '../../src/listen/describe/context';
import { createSpectrogramRunner, type SpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { ListenModelMissing } from '../../src/listen/errors';
import {
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
} from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { fakeOrt, type OrtLog } from './analysis-fakes';

export function memoryJson(): DerivedJson & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async read(key) {
      const found = entries.get(key);
      return found === undefined ? err(ListenModelMissing({ component: 'none' })) : ok(JSON.parse(found));
    },
    async write(key, json) {
      entries.set(key, JSON.stringify(json));
      return ok(undefined);
    },
  };
}

/** What the component manager holds: the build (id/version) of each model on disk, and what this machine picks. */
export interface Disk {
  /** id → version folder, e.g. `{ 'clap-general-audio-fp16': 'v1' }`. */
  readonly builds: Record<string, string>;
  /** The machine's pick per model: fp16 by default (a Metal Mac). */
  readonly dtype?: 'fp16' | 'int8';
  /** Installs fail (offline). */
  readonly offline?: boolean;
}

export function diskFiles(disk: Disk): ListenModelFiles & { readonly downloads: string[] } {
  const downloads: string[] = [];
  const pick = (name: ListenModelName) => LISTEN_COMPONENTS[name] + (disk.dtype === 'int8' ? '' : '-fp16');
  const build = (name: ListenModelName, id: string) => {
    const dir = `/c/${id}/${disk.builds[id] ?? 'v1'}`;
    const dtype = id.endsWith('-fp16') ? ('fp16' as const) : ('int8' as const);
    return { name, componentId: id, dir, modelPath: `${dir}/model.onnx`, dtype };
  };
  return {
    downloads,
    async resolve(name) {
      const id = pick(name);
      if (!(id in disk.builds)) {
        if (disk.offline) return err(ListenModelMissing({ component: LISTEN_COMPONENTS[name] }));
        downloads.push(id);
        disk.builds[id] = 'v1';
      }
      return ok(build(name, id));
    },
    async installed(name) {
      const id = pick(name);
      return id in disk.builds ? build(name, id) : undefined;
    },
  };
}

export interface RigOptions {
  readonly disk: Disk;
  readonly json?: ReturnType<typeof memoryJson>;
  readonly critic?: (input: CritiqueInput) => AsyncResult<SoundCritique | null>;
  readonly realness?: (input: ListenPassInput) => AsyncResult<SoundRealness | null>;
  /** ORT providers whose model runs throw (a GPU failure mid-run). */
  readonly runFails?: boolean;
}

export function analysisRig(options: RigOptions) {
  const log: OrtLog = { opened: [], released: [] };
  const lines: string[] = [];
  const counts = { realness: 0, critiques: 0 };
  const json = options.json ?? memoryJson();
  const files = diskFiles(options.disk);
  let set: ListenModelSet | undefined;
  let runner: SpectrogramRunner | undefined;
  const { critic } = options;
  const ort = fakeOrt(log);
  const failing = options.runFails
    ? {
        ...ort,
        InferenceSession: {
          async create(...args: Parameters<typeof ort.InferenceSession.create>) {
            const session = await ort.InferenceSession.create(...args);
            if (typeof args[0] !== 'string') return session;
            return { ...session, run: async () => Promise.reject(new Error('WebGPU device lost')) };
          },
        },
      }
    : ort;
  const deps: ListenAnalysisDeps = {
    async spectrograms() {
      return (runner ??= createSpectrogramRunner({ plan: { devices: ['cpu'] } }));
    },
    async models() {
      if (!set) {
        const sessions = createListenSessions({ files, loadModule: async () => failing });
        const local = sessions.installedOnly();
        set = {
          sessions,
          files,
          models: createListenModels(sessions, files),
          installedOnly: { sessions: local, files, models: createListenModels(local, files) },
        };
      }
      return set;
    },
    cache: createListenAnalysisCache(json),
    log: (line) => lines.push(line),
    async realness(input) {
      counts.realness++;
      if (options.realness) return options.realness(input);
      if (!input.models) return ok(null);
      const embedded = await input.models.clap.embedSource(input.source.samples, undefined, input.signal);
      return embedded.ok ? ok({ pReal: 0.8, verdict: 'real' }) : embedded;
    },
    ...(critic
      ? {
          critique: async (input: CritiqueInput) => {
            counts.critiques++;
            return critic(input);
          },
        }
      : {}),
  };
  return { deps, files, json, log, lines, counts };
}
