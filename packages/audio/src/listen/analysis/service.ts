// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening runtime of one process (EAR1-F7): what the jobs process composes once (apps/desktop
 * roots/audio-listen.ts) and serves `audio.listen.*` from. Nothing opens at start: the spectrogram runner is made on
 * the first analysis, the model sessions on the first model part, each on the listen device plan (the probe's), with
 * one model resident on an 8 GB machine and any model idle for 60 s released (models/sessions.ts). The models'
 * builds are looked up per call (`files`), so a component installed (or updated) later is used by the next job; a
 * request that says `install: false` runs on the same sessions over a lookup that never installs (EAR1-R1). A
 * query's sources are decoded one at a time as its operation reads them (queries.ts `listenSourceList`).
 */
import { err, type AsyncResult, type ComputeFallbackEvent, type SoundListener } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { DerivedJson } from '../../cleanup/speech-files';
import { createListenModels } from '../describe/context';
import {
  createSpectrogramRunner,
  type SpectrogramRunner,
  type SpectrogramRunnerOptions,
} from '../dsp/spectrogram-graph';
import { ListenBadInput, ListenUnavailable } from '../errors';
import type { ListenDevicePlan } from '../models/devices';
import type { ListenModelFiles, ListenModelName } from '../models/files';
import { createListenSessions, type ListenSessionsOptions, type ListenTimers } from '../models/sessions';
import { createSoundListener, type HearOptions } from '../listener';
import {
  analyseSound,
  type AnalyseSoundRequest,
  type ListenAnalysisDeps,
  type ListenModelSet,
} from './analyse';
import type { ListenAnalysisCache } from './cache';
import { LISTEN_EXTENSIONS, type ListenExtensions, type ListenQueryOp } from './extensions';
import { BUILT_IN_LISTEN_QUERIES, checkQuery, listenSourceList, type ListenSourceRef } from './queries';
import type { SoundAnalysis } from './schema';

export interface ListenServiceOptions {
  /** FFmpeg (media's binaries and session context), asked per call. */
  readonly media: () => AsyncResult<MediaContext>;
  /** The models' builds: `installedListenFiles(components)` in the app. Absent: signal processing only. */
  readonly files?: ListenModelFiles;
  /** The listen device plan (the desktop's machineListenPlan); default WebGPU, then the CPU. */
  readonly plan?: () => Promise<ListenDevicePlan>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** The 8 GB rule: one model open at a time (the minimum hardware tier). Asked once, at the first model. */
  readonly singleResident?: () => Promise<boolean>;
  readonly idleMs?: number;
  readonly timers?: ListenTimers;
  readonly loadModule?: ListenSessionsOptions['loadModule'];
  readonly cache?: ListenAnalysisCache;
  /** EAR1-G2: media's derived JSON (the analyses' store), where the models keep the SFX bank's title embeddings. */
  readonly json?: DerivedJson;
  readonly log?: (line: string) => void;
  /** The lanes' plug-ins; default LISTEN_EXTENSIONS. */
  readonly extensions?: ListenExtensions;
  /** The spectrogram runner's own settings (tests: `cpuGraph`, `loadModule`). */
  readonly spectrogram?: Omit<SpectrogramRunnerOptions, 'plan' | 'onFallback'>;
  /** How the in-process listener hears renders. */
  readonly hear?: HearOptions;
}

export interface ListenService {
  analyse(request: AnalyseSoundRequest): AsyncResult<SoundAnalysis>;
  /** An operation by name (built in, or a lane's); its params are checked against its schema. */
  query(
    op: string,
    sources: readonly ListenSourceRef[],
    params: unknown,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<unknown>;
  /** Every operation this service answers. */
  readonly queries: readonly ListenQueryOp[];
  /** Core's SoundListener, analysing in this process. */
  readonly listener: SoundListener;
  /** What `analyseSound` runs on here, for in-process callers that compose their own passes. */
  readonly deps: ListenAnalysisDeps;
  /** The models open now. */
  resident(): readonly ListenModelName[];
  /** Closes every session and the spectrogram graphs (the process is going away). */
  release(): Promise<void>;
}

export function createListenService(options: ListenServiceOptions): ListenService {
  const extensions = options.extensions ?? LISTEN_EXTENSIONS;
  let runner: Promise<SpectrogramRunner> | undefined;
  let set: Promise<ListenModelSet> | undefined;
  let open: ListenModelSet | undefined;
  const spectrograms = () =>
    (runner ??= (async () =>
      createSpectrogramRunner({
        ...options.spectrogram,
        ...(options.plan ? { plan: await options.plan() } : {}),
        ...(options.onFallback ? { onFallback: options.onFallback } : {}),
      }))());
  const files = options.files;
  const models = files
    ? () =>
        (set ??= (async () => {
          const sessions = createListenSessions({
            files,
            ...(options.plan ? { plan: options.plan } : {}),
            ...(options.onFallback ? { onFallback: options.onFallback } : {}),
            ...(options.loadModule ? { loadModule: options.loadModule } : {}),
            ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
            ...(options.timers ? { timers: options.timers } : {}),
            ...(options.log ? { log: options.log } : {}),
            singleResident: (await options.singleResident?.()) ?? false,
          });
          const kept = {
            ...(options.json ? { json: options.json } : {}),
            ...(options.log ? { log: options.log } : {}),
          };
          // `install: false` (render QA): the same sessions, never installing, at planning or at run time.
          const local = sessions.installedOnly();
          const installedOnly: ListenModelSet = {
            sessions: local,
            files,
            models: createListenModels(local, files, kept),
          };
          open = { sessions, files, models: createListenModels(sessions, files, kept), installedOnly };
          return open;
        })())
    : undefined;
  const deps: ListenAnalysisDeps = {
    media: options.media,
    spectrograms,
    ...(models ? { models } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(extensions.realness ? { realness: extensions.realness } : {}),
    ...(extensions.critique ? { critique: extensions.critique } : {}),
    ...(options.log ? { log: options.log } : {}),
  };
  const queries = [...BUILT_IN_LISTEN_QUERIES, ...extensions.queries];
  const byName = new Map(queries.map((op) => [op.op, op]));

  return {
    analyse: (request) => analyseSound(deps, request),
    async query(name, refs, params, { signal } = {}) {
      const op = byName.get(name);
      if (!op) return err(ListenBadInput(undefined, { detail: `no listen query '${name}'` }));
      const checked = await checkQuery(op, refs.length, params);
      if (!checked.ok) return checked;
      if (!models) return err(ListenUnavailable({ reason: 'no_models' }));
      const loaded = await models();
      // A missing model fails before anything is decoded.
      const clap = await loaded.sessions.model('clapAudio', signal);
      if (!clap.ok) return clap;
      const media = await options.media();
      if (!media.ok) return media;
      return op.run(
        {
          models: loaded.models,
          sources: listenSourceList(refs, media.value),
          spectrograms,
          audioDtype: clap.value.dtype,
          ...(signal ? { signal } : {}),
        },
        checked.value,
      );
    },
    queries,
    listener: createSoundListener(deps, options.hear),
    deps,
    resident: () => open?.sessions.resident() ?? [],
    async release() {
      const [made, loaded] = await Promise.all([runner, set]);
      await Promise.all([made?.release(), loaded?.sessions.release()]);
    },
  };
}
