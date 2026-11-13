// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's Phase 3 in the agent and jobs processes (render SPEC P3.15): the graphics and batch commands and
 * the graphics tools in the agent (agent-render.ts adds them), core's ContentCredentials for audio and models,
 * the subject track reader for the timeline lane's punch-ins, and the `render.trackSubjects` job (render-jobs.ts
 * adds it), which tracks a shot with the mac helper and keeps the track in the media cache.
 */
import { dirname, join } from 'node:path';
import {
  ContentCredentialsToken,
  err,
  EventBusToken,
  JobRunnerToken,
  NotFoundError,
  SubjectSourceToken,
  SubjectTrackReaderToken,
  TimelineStoreToken,
  type JobRunner,
  type AnyCommand,
  type ComputeFallbackEvent,
  type Container,
  type JobRegistration,
  type AsyncResult,
  type ToolModule,
} from '@taalcut/core';
import {
  compositionToolModule,
  createBatchCommands,
  createCompositionCommands,
  createSubjectSource,
  createSubjectTracker,
  trackSubjectsRegistration,
  type HelperRequester,
  type RenderCommandDeps,
  type SubjectTracker,
  type TrackShotInput,
  type TrackShotResult,
} from '@taalcut/render';
import { clipNumberingOf } from '@taalcut/timeline';
import { hostPlatform } from '../../platform';
import { mediaCacheRoot } from '../../shared/media-cache';
import { renderTimelines, renderTranscripts } from '../../shared/render-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import {
  contentCredentials,
  hardwareLease,
  libraryRoots,
  macHelpers,
  subjectTrackStore,
  trackerCpuFallback,
  trackingAsset,
} from './render-phase3';
import { desktopOnnxTracker } from './render-subjects-onnx';

const fallbackOn = (container: Container) => {
  const events = container.resolve(EventBusToken);
  return (event: ComputeFallbackEvent) => events.emit('compute.fallback', event);
};

/** Where `readBytes` stages a generated file's bytes for one read: inside userData, one of the sidecar's roots. */
export const c2paStagingDir = (userData: string) => join(userData, 'c2pa-staged');

/**
 * ContentCredentialsToken (read: generated media's manifests at ingest, audio and models, and bytes in memory
 * for models' image providers) and SubjectTrackReaderToken, unless this process has them already.
 */
export function registerRenderPhase3(container: Container, config: UtilityConfig): void {
  if (!container.has(ContentCredentialsToken))
    container.value(
      ContentCredentialsToken,
      contentCredentials(
        config,
        () => [config.userData, mediaCacheRoot(config.userData), ...libraryRoots(container)],
        fallbackOn(container),
        c2paStagingDir(config.userData),
      ),
    );
  if (!container.has(SubjectTrackReaderToken))
    container.value(SubjectTrackReaderToken, subjectTrackStore(container, config));
  // FRM1-SUB: where people are in a clip, for placement, preview, QA and reframing; tracks through the jobs queue.
  if (!container.has(SubjectSourceToken))
    container.value(
      SubjectSourceToken,
      createSubjectSource({
        store: subjectTrackStore(container, config),
        runner: queueOf(container),
        asset: trackingAsset(container),
      }),
    );
}

/** The jobs queue as this process has it when a track is asked for (it may be registered after this root). */
const queueOf = (container: Container): Pick<JobRunner, 'run'> => ({
  run: (kind, input, options) =>
    container.has(JobRunnerToken)
      ? container.resolve(JobRunnerToken).run(kind, input, options)
      : Promise.resolve(err(NotFoundError({ entity: 'jobRunner' }))),
});

/** The graphics commands (a graphic is a composition) and render.exportBatch/cancelBatch on the agent's bus. */
export function renderPhase3Commands(container: Container, deps: RenderCommandDeps): readonly AnyCommand[] {
  const graphics = createCompositionCommands({
    timelines: renderTimelines(container),
    transcripts: renderTranscripts(container),
  });
  return [...graphics.all, ...createBatchCommands(deps).all] as readonly AnyCommand[];
}

/** The `graphics` tool module: list, edit, remove and design (render.exportBatch is in the `render` module). */
export function renderPhase3ToolModules(container: Container): readonly ToolModule[] {
  return [
    compositionToolModule({
      timelines: renderTimelines(container),
      // HFW1-DSN: a recorded design job is the docked run's change, so the Editor's check doesn't send it back.
      ...designRecordedOf(container),
    }),
  ];
}

/** Spends the run's one "you changed nothing" ask (the Editor's check, timeline's ClipNumbering). */
const designRecordedOf = (container: Container) =>
  container.has(TimelineStoreToken)
    ? {
        designRecorded: (runId: string) => {
          clipNumberingOf(container.resolve(TimelineStoreToken)).firstAsk(runId, 'handoff');
        },
      }
    : {};

type MacHelpers = (services: string, roots: readonly string[]) => AsyncResult<HelperRequester>;

/** Tracks a shot on the mac helper started for the original's folder (its allowed root). */
async function trackOnHelper(helpers: MacHelpers, input: TrackShotInput): AsyncResult<TrackShotResult> {
  const helper = await helpers('track', [dirname(input.path)]);
  if (helper.ok) return createSubjectTracker(helper.value).track(input);
  // No helper, no request: nothing holds a session, so the lease goes back now (IX3-F5, H6).
  input.onLetGo?.();
  return helper;
}

/** The tracker on the mac helpers. */
export const helperTracker = (helpers: MacHelpers): SubjectTracker => ({
  track: (input) => trackOnHelper(helpers, input),
});

/**
 * `render.trackSubjects` in the jobs process: on a Mac the helper, started per original's folder (its allowed root);
 * elsewhere vision's ONNX detector (FRM1-SUB, render-subjects-onnx.ts).
 */
export function renderPhase3Jobs(config: UtilityConfig, container: Container): readonly JobRegistration[] {
  return [
    trackSubjectsRegistration({
      tracker: hostPlatform().abilities.nativeSubjects
        ? helperTracker(macHelpers(config))
        : desktopOnnxTracker(config, container, fallbackOn(container)),
      store: subjectTrackStore(container, config),
      asset: trackingAsset(container),
      ...hardwareLease(container),
      onCpu: trackerCpuFallback(fallbackOn(container)),
    }),
  ];
}
