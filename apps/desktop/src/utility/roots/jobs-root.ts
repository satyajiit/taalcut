// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's composition root: the durable job engine over the
 * library's jobs table, throttled by main's power snapshots; the media job
 * kinds (FFmpeg from the app's sidecars); the component and model download
 * manager over the signed manifest. Serves UTILITY_CONTRACTS.jobs:
 * diagnostics, events, jobs, power, and for the agent process (through main)
 * runner, which runs a job kind, and components, which installs its local
 * runtime and models and lists them for Settings → About.
 */
import { join } from 'node:path';
import { speechPcmPort } from '@taalcut/audio';
import {
  AcknowledgementStoreToken,
  backgroundModelsOverRpc,
  ClockToken,
  componentInstallerRouter,
  embeddingsRouter,
  EventBusToken,
  implementContract,
  jobEnqueueRouter,
  JobQueueToken,
  jobRunnerRouter,
  jobsRouter,
  JobStoreToken,
  MEDIA_CACHE_CAP_SETTING,
  powerRouter,
  err,
  ok,
  SettingsStoreToken,
  toTaalcutError,
  UTILITY_CONTRACTS,
  type AsyncResult,
  type JobRegistration,
  type PortLike,
} from '@taalcut/core';
import {
  createEngineJobRunner,
  createJobEngine,
  fromJobKind,
  unacceptedTerms,
  type ComponentManifest,
  type TermsBook,
} from '@taalcut/jobs';
import { createJobRepository, offlineContentHashes } from '@taalcut/library';
import { createMediaService } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import {
  ComponentManagerToken,
  ComponentVariantToken,
  JobEngineToken,
  LibraryDatabaseToken,
} from '../../shared/tokens';
import { jobsDebugRouter } from '../debug/jobs-bundle';
import type { UtilityRoot } from '../runtime';
import { composeAudio } from './audio';
import { warmListenTitles } from './audio-listen-warm';
import { AudioIndexingToken } from './audio-indexing';
import { commonRouters, createUtilityContainer } from './base';
import { registerHardwareSessions } from './hardware-sessions';
import { installAsAsked, signedComponentManager } from './components';
import { repairCudaRuntime } from './gpu-setup';
import { devComponentSource, startDevComponents, type DevComponents } from './dev-components';
import { createDownloadsFeed } from './downloads-feed';
import { downloadsReport } from './downloads-wire';
import { registerExperimentSweep, startExperimentSweeps } from './experiment-sweep';
import { macHardware } from './hardware';
import { registerIndexStages } from './index-stages';
import { withImportReadLeases } from './import-read-leases';
import { PlatformServicesToken } from '../../platform';
import { originalsRoot } from './library-agent';
import { applyHardwarePlan } from './job-concurrency';
import { engineJobQueue, engineStore, forwardedPower, jobEventSink } from './job-engine-glue';
import {
  indexingSettled,
  libraryIndexingRouter,
  libraryJobs,
  registerLibraryJobs,
  modelsInstalled,
  releaseCacheFile,
  startLibraryJobs,
} from './library-jobs';
import { registerLibraryPhase3Jobs } from './library-phase3';
import { placeJobRegistrations, registerPlaces } from './library-places';
import { mainServices } from './main-services';
import { mediaBinaries, wireMediaJobs } from './media-jobs';
import { renderJobs } from './render-jobs';
import { templateJobs } from './template-jobs';
import { workspaceShellJobs } from './workspace-shell';
import { componentList, usedByOf } from './system-info';
import { composeVision, type VisionOptions } from './vision';
import { componentFits, describeMachine } from './component-fit';
import { createDesktopLookPorts } from './vision-look';
import { spokenLanguagesNow, wantedComponent as wanted } from './audio-spoken-languages';

export { mediaBinaries } from './media-jobs';

export interface JobsRootOptions {
  readonly pid?: number;
  /** Replaces the media kinds (tests). */
  readonly jobs?: readonly JobRegistration[];
  /** Replaces the signed manifest (tests). */
  readonly manifest?: ComponentManifest;
  /** Where TAALCUT_DEV_COMPONENTS is read (dev-components.ts). Default process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Refuses a manifest signed with the development key (a packaged release build: refusesDevelopmentKey). Default true. */
  readonly release?: boolean;
  /** The port to main's services (MAIN_SERVICE_CONTRACTS.jobs): the render worker runs export jobs. */
  readonly main?: PortLike;
  /** From the entry (jobs.ts): the shot model's process (IX2-S2) and, in test builds, vision's stand-ins. */
  readonly vision?: VisionOptions;
}

export function composeJobs(config: UtilityConfig, options: JobsRootOptions = {}): UtilityRoot {
  const container = createUtilityContainer(config);
  // Probed once, on first use: stage tiers, components' `recommended`, the session cap, the engine's lane plan.
  const hardware = macHardware(config.userData);
  // One cap on VideoToolbox sessions for this process and the render process (media's gate).
  const hardwareSessions = registerHardwareSessions(container, config.userData, hardware);
  const power = forwardedPower();
  // Waveforms take their peaks from the audio pass (audio's store: registered by composeAudio, made on first use).
  const speechPcm = speechPcmPort(() => container.resolve(AudioIndexingToken).store);
  // Tests pass their own kinds and do not create a cache directory.
  const media =
    options.jobs === undefined ? wireMediaJobs(config, hardwareSessions, speechPcm, hardware) : undefined;
  // Vision's kinds, embedder and OCR open nothing until the first job or search (roots/vision.ts).
  const mediaService =
    media?.service ?? createMediaService({ resolver: mediaBinaries(config), hardwareSessions });
  const main = mainServices(options.main);
  const componentManager = () => container.resolve(ComponentManagerToken);
  const look = media ? createDesktopLookPorts(container, media.service, media.cache) : undefined;
  const vision = composeVision(
    container,
    config,
    mediaService,
    componentManager,
    main ? backgroundModelsOverRpc(() => main.models) : undefined,
    {
      ...options.vision,
      ...(look ? { look } : {}),
      // The proxy, for analysis passes the frame-input policy points at it.
      ...(media
        ? {
            derivedPath: (key: string) => media.cache.absPath(key),
            storeSheet: (key: string, body: Buffer) => media.cache.put(key, body),
          }
        : {}),
    },
  );
  // Audio and the full stage list only with the real kinds (tests that pass `jobs` keep library.hash alone).
  const audio =
    options.jobs === undefined
      ? composeAudio(container, config, mediaService, componentManager, media?.cache)
      : undefined;
  if (options.jobs === undefined) registerIndexStages(container, config, hardware);
  // LIB1-PLACE: place names and trips (library-places.ts).
  if (options.jobs === undefined) registerPlaces(container, config);
  registerLibraryJobs(container);
  // Generated files the jobs process keeps (library-phase3.ts).
  registerLibraryPhase3Jobs(container);
  registerExperimentSweep(container, config);
  const registrations = [
    ...(options.jobs ?? [
      ...(media?.jobs ?? []),
      ...vision.jobs,
      ...(audio?.jobs ?? []),
      ...renderJobs(config, container, options.main),
      ...templateJobs(config, container, mediaService, vision),
      // AGT2 sbx: the workspace shell's commands and toolchain (workspace-shell.ts).
      ...workspaceShellJobs(config, container, mediaService),
      ...placeJobRegistrations(container),
    ]),
    ...libraryJobs(container),
  ];

  container.factory(
    JobEngineToken,
    ({ db, events, clock }) => {
      // The cache's cap: the queue, Settings and the library are read when a run starts, after start (cache-cap.ts).
      media?.attach(events, {
        queue: () => container.resolve(JobQueueToken),
        capBytes: () => container.resolve(SettingsStoreToken).get(MEDIA_CACHE_CAP_SETTING),
        release: (key) => releaseCacheFile(container, key),
        offlineHashes: () => offlineContentHashes(db),
      });
      const engine = createJobEngine({
        // The lease-based repository; reads for the renderer go through core's JobStore port.
        store: engineStore(createJobRepository(db)),
        power: power.power,
        events: jobEventSink(events),
        clock: () => clock.now(),
        // The app's only jobs process: after the supervisor restarts it, the dead instance's
        // leases are taken over at once instead of after they expire; each job row counts its interruptions.
        exclusive: true,
        log: (message) => console.warn(`[jobs] ${message}`),
        afterJob: (jobId) => indexingSettled(container, jobId), // depth-first: dependants fed before the slot frees
      });
      // Job kinds: each package's registrations (media now; vision, render and components as they land).
      const volumes = container.resolve(PlatformServicesToken).volumeProbe();
      for (const { kind, handler } of registrations)
        engine.register(
          fromJobKind(
            kind,
            withImportReadLeases(
              db,
              volumes,
              handler,
              kind.kind === 'library.sweepStaging' ? async () => [originalsRoot(db)] : undefined,
            ),
          ),
        );
      return engine;
    },
    {
      deps: { db: LibraryDatabaseToken, events: EventBusToken, clock: ClockToken },
      dispose: (engine) => {
        media?.stopCap();
        return engine.stop();
      },
    },
  );
  container.factory(
    JobQueueToken,
    ({ engine, store, clock }) => engineJobQueue(engine, store, () => clock.now()),
    { deps: { engine: JobEngineToken, store: JobStoreToken, clock: ClockToken } },
  );
  // Set once the library jobs run: an install before then has nothing waiting to wake.
  let libraryStarted = false;
  const downloads = async () => downloadsReport(await components.downloads.status(), usedByOf);
  // LNX1-TRM: the person's acceptance of a component owner's terms, which the window records in the library's
  // acknowledgements (appContract.acknowledgements, the agent process); read here, at each plan, from the same store.
  const terms: TermsBook = {
    has: (feature, version) => container.resolve(AcknowledgementStoreToken).has(feature, version),
  };
  // The download's event. It reads the download's state, so it reads only once the manager below exists: the
  // manager tells it of a change no sooner than its first download starts.
  const feed = createDownloadsFeed({
    read: downloads,
    emit: (state) => container.resolve(EventBusToken).emit('components.downloads', state),
  });
  // A development run may install from a local release instead (UX3-IDX); a packaged app never does.
  const local = devComponentSource(options.env ?? process.env, config.packaged);
  if (local.kind === 'refused') console.warn(`[components] ${local.reason}`);
  let served: DevComponents | undefined;
  const fromRelease =
    local.kind === 'on'
      ? async (): AsyncResult<ComponentManifest> => {
          const started = await startDevComponents({
            releaseDirs: local.releaseDirs,
            manifestPath: config.componentManifest,
            log: (message) => console.warn(message),
          });
          if (!started.ok) return started;
          served = started.value;
          return ok(started.value.manifest);
        }
      : undefined;
  const components = signedComponentManager({
    root: join(config.userData, 'components'),
    manifestPath: config.componentManifest,
    release: options.release ?? true,
    ...(options.manifest ? { manifest: options.manifest } : fromRelease ? { manifest: fromRelease } : {}),
    // The stages waiting for a model try again now, not at their next probe (UX2-MODELS).
    onInstalled: (installed) => {
      if (libraryStarted)
        void modelsInstalled(container).catch((cause: unknown) =>
          console.warn(`[indexing] re-queue after an install failed: ${String(cause)}`),
        );
      // EAR1-G2: the SFX bank's titles embedded for search once the bank and CLAP are all here (never downloads).
      void warmListenTitles(container, installed);
    },
    // Everything this machine needs: what its tier lists, of what runs on it (UX2-DOWNLOADER), each accelerator
    // build checked against the probe's GPUs (LNX1 seam 4).
    machine: async () => {
      try {
        const probed = await hardware();
        const machine = describeMachine(probed.info);
        // LIB1-LANG: the Indian-language identifier only when the person's or the app's languages need it.
        const languages = await spokenLanguagesNow(container.resolve(SettingsStoreToken));
        return ok({
          tier: probed.assessment.tier,
          machine,
          runsHere: (id) => componentFits({ id }, machine) && wanted(id, languages),
        });
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    onDownloadsChange: (kind) => feed.changed(kind),
    terms,
  });
  // At quit the download and every install stop, and their writes land before the process exits; resolved now,
  // before the engine, so the engine's jobs (which may use it) are disposed first.
  container.factory(ComponentManagerToken, () => components, {
    dispose: async (manager) => {
      feed.stop();
      await manager.close();
      await served?.close();
    },
  });
  container.resolve(ComponentManagerToken);
  // EAR1-G2: the build of a variant group that runs here, for the listen models' installs and warm-up.
  container.value(ComponentVariantToken, (id: string) => components.variantOf(id));

  const engine = container.resolve(JobEngineToken);
  const queue = container.resolve(JobQueueToken);
  const os = implementContract(UTILITY_CONTRACTS.jobs);
  const router = os.router({
    ...commonRouters(container, 'jobs', options.pid ?? process.pid),
    jobs: jobsRouter(queue),
    queue: jobEnqueueRouter(queue),
    power: powerRouter((snapshot) => power.apply(snapshot)),
    runner: jobRunnerRouter(createEngineJobRunner(engine), registrations),
    components: componentInstallerRouter({
      install: installAsAsked(components),
      get: (id) => components.get(id),
      list: async () => {
        const statuses = await components.list();
        if (statuses.length === 0) return [];
        const probed = await hardware().catch(() => undefined);
        const machine = probed ? describeMachine(probed.info) : undefined;
        const languages = await spokenLanguagesNow(container.resolve(SettingsStoreToken));
        const here = statuses.filter(
          (status) =>
            componentFits(status, machine) && (wanted(status.id, languages) || status.state === 'installed'),
        );
        return componentList(here, await components.downloads.status(), await unacceptedTerms(here, terms));
      },
      downloads,
      startDownloads: async ({ first }) => {
        await repairCudaRuntime(components, { root: join(config.userData, 'components') });
        const started = await components.downloads.start(first ? { first } : {});
        return started.ok ? ok(downloadsReport(started.value, usedByOf)) : started;
      },
      pauseDownloads: async () => downloadsReport(await components.downloads.pause(), usedByOf),
      cancelDownloads: async () => downloadsReport(await components.downloads.cancel(), usedByOf),
    }),
    // EmbeddingGemma 2 (P2-L9), for library search and casting in other processes.
    embeddings: embeddingsRouter(vision.embedder),
    // Job rows and component status for the debug bundle (P2-X5). No payloads or paths.
    debugBundle: jobsDebugRouter({
      jobs: async () => {
        const listed = await queue.list();
        return listed.ok ? listed.value : [];
      },
      components: () => components.list(),
    }),
    // The library's indexing pipeline (P2-L13).
    indexing: libraryIndexingRouter(container),
  });
  const start = async () => {
    // The manifest's verdict is logged at start, not at the first install. Then an unfinished download of
    // everything this Mac needs goes on by itself, as it was left (UX2-DOWNLOADER).
    void components
      .ready()
      .then(() => components.downloads.restore())
      .catch((cause: unknown) => console.warn(`[components] ${String(cause)}`));
    if (media) await media.readCap(container.resolve(SettingsStoreToken));
    void applyHardwarePlan(engine, hardware); // this machine's budgets and lanes once probed; defaults until then
    await engine.start();
    await startLibraryJobs(container);
    libraryStarted = true;
    // A cache already over its cap is kept to it, 30 s on, keeping what is in use: the clips the windows show are
    // main's list, in the library, so they are held from the first run (cache-cap.ts).
    media?.checkCap();
    // Expired reference experiments go at start and hourly (analyse and discard); live ones can resume.
    startExperimentSweeps(container);
  };
  // At quit the running jobs are aborted and handed back at once (the process has 2 s, exitOnTerminate), so the
  // next start runs them again; only then does the container close what they were using.
  return { container, router, start, stop: () => engine.stop({ graceMs: 0 }) };
}
