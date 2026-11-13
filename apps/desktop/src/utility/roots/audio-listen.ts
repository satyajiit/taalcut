// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 listening in the jobs process (packages/audio SPEC "EAR1 jobs and wiring"): one listen service for the
 * process, serving `audio.listen.analyse` and `audio.listen.query` to every other process through the job runner
 * (render's QA, the agent's tools), and in-process to this one's own callers by ListenServiceToken (the breakdown)
 * and core's SoundListenerToken.
 *
 * Nothing loads at start. Each job looks the models up again through the component manager (`variant: true`: the
 * build ComponentVariantToken names, fp16 on a Metal Mac, int8 elsewhere and under TAALCUT_FORCE_CPU; the manager's
 * own install takes ids as given), installing one on first use unless the request says not to; a model that can't
 * be had fails that job with `audio.listen_model_missing` naming the component. A request that says not to install
 * (render QA) counts only that same build as installed (EAR1-R1): the other dtype on disk is not this machine's. Sessions and spectrogram graphs
 * open on the probe's devices (machineListenPlan) and log every CPU choice as `compute.fallback` on this process's
 * bus. The 8 GB rule: on the minimum hardware tier one model stays open at a time; any model idle for 60 s is
 * released. Analyses are cached as derived JSON in media's cache, and so are the SFX bank titles' text embeddings
 * (EAR1-G2), warmed after the installs that complete them (audio-listen-warm.ts).
 */
import {
  createToken,
  EventBusToken,
  ok,
  SoundListenerToken,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Container,
  type JobRegistration,
} from '@taalcut/core';
import {
  createListenAnalysisCache,
  createListenJobs,
  createListenService,
  installedListenFiles,
  type ListenService,
} from '@taalcut/audio';
import type { ComponentManager } from '@taalcut/jobs';
import type { DerivedCache, MediaService } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ComponentVariantToken, type ProbedHardware } from '../../shared/tokens';
import { cacheJson } from './audio-library';
import { macHardware } from './hardware';
import { sessionContext } from './hardware-sessions';
import { componentsRoot, machineListenPlan } from './machine-accelerators';

/** The jobs process's listen service: in-process analyses and queries (lane C's breakdown resolves it here). */
export const ListenServiceToken = createToken<ListenService>('audio.listenService');

/**
 * The build of a listen model's variant group that runs here, as the download chooses it (fp16 on a Metal Mac, the
 * int8 base under TAALCUT_FORCE_CPU), installing nothing; `id` itself where no chooser is registered (tests).
 */
export function listenBuildHere(container: Container, id: string): AsyncResult<string> {
  return container.has(ComponentVariantToken)
    ? container.resolve(ComponentVariantToken)(id)
    : Promise.resolve(ok(id));
}

export interface ListenRootDeps {
  readonly media: MediaService;
  readonly components: () => ComponentManager;
  /** Media's derived cache; without one, nothing is cached. */
  readonly cache?: DerivedCache;
  /** The process's hardware probe (composeAudio's); default a probe of its own. */
  readonly hardware?: () => Promise<ProbedHardware>;
  readonly log?: (line: string) => void;
}

/** Registers the service (and the in-process SoundListener) and returns the listen job kinds. */
export function composeListen(
  container: Container,
  config: UtilityConfig,
  deps: ListenRootDeps,
): { readonly jobs: readonly JobRegistration[] } {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const events = container.resolve(EventBusToken);
  const onFallback = (event: ComputeFallbackEvent) => events.emit('compute.fallback', event);
  const hardware = deps.hardware ?? macHardware(config.userData);
  const { cache } = deps;
  const json = cache ? cacheJson(() => cache) : undefined;
  container.factory(
    ListenServiceToken,
    () =>
      createListenService({
        media: async () => {
          const binaries = await deps.media.binaries();
          return binaries.ok
            ? { ok: true as const, value: { binaries: binaries.value, ...sessionContext(container) } }
            : binaries;
        },
        files: installedListenFiles(
          {
            // The manager's own install takes ids as given: a model's build that runs here is asked for by name.
            install: async (id, { variant, ...options } = {}) => {
              const chosen = variant ? await listenBuildHere(container, id) : ok(id);
              return chosen.ok ? deps.components().install(chosen.value, options) : chosen;
            },
            get: (id) => deps.components().get(id),
          },
          // Installed means this machine's build is (EAR1-R1); without a chooser (tests), either build.
          container.has(ComponentVariantToken) ? { variantOf: (id) => listenBuildHere(container, id) } : {},
        ),
        plan: machineListenPlan(hardware, componentsRoot(config.userData), log),
        onFallback,
        // The 8 GB rule; a failed probe counts as the smallest machine.
        singleResident: async () => {
          try {
            return (await hardware()).assessment.tier === 'minimum';
          } catch {
            return true;
          }
        },
        // Analyses, and (EAR1-G2) the SFX bank titles' text embeddings, as derived JSON in media's cache.
        ...(json ? { cache: createListenAnalysisCache(json, log), json } : {}),
        log,
      }),
    { dispose: (service) => service.release() },
  );
  if (!container.has(SoundListenerToken))
    container.factory(SoundListenerToken, () => container.resolve(ListenServiceToken).listener);
  const service = () => container.resolve(ListenServiceToken);
  return {
    jobs: createListenJobs({
      analyse: (request) => service().analyse(request),
      query: (op, sources, params, options) => service().query(op, sources, params, options),
    }),
  };
}
