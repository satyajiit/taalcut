// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates lane in the jobs process (packages/templates SPEC, "Job
 * kinds"): the experiment sandbox in exec mode with its `sandbox.run` kind,
 * and `templates.fetchReference` and `templates.breakdown` over the real
 * analysers (template-analysers.ts, template-audio.ts). Nothing opens at
 * start: FFmpeg, the embedder, OCR and the beat model load at the first
 * breakdown. A link is fetched without an account first; the Instagram
 * session's cookie file, which the agent leaves in the experiment, is read
 * only when the reel needs a login (REF1: no acknowledgement gates it).
 *
 * Test builds may set TAALCUT_TEST_STANDIN_ANALYSERS=1: steps whose model
 * component isn't installed then use stand-ins and never download
 * (template-standins.ts, loaded by import() only in a test build).
 */
import { ClockToken, ok, type Container, type JobRegistration } from '@taalcut/core';
import { HardwareFailures, ToneMapSelection, type MediaContext, type MediaService } from '@taalcut/media';
import { createTemplateJobs, type BreakdownAudio } from '@taalcut/templates';
import { createSandboxJobs } from '@taalcut/tools';
import { EMBEDDING_COMPONENT } from '@taalcut/vision';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ComponentManagerToken } from '../../shared/tokens';
import { macHardware } from './hardware';
import { HardwareSessionsToken, sessionContext } from './hardware-sessions';
import { componentsRoot, machineBeatPlan } from './machine-accelerators';
import { macHelpers } from './render-phase3';
import { cameraMotionAnalyser } from './camera-analyser';
import { breakdownMedia, breakdownVision } from './template-analysers';
import { breakdownAudio } from './template-audio';
import { ListenServiceToken } from './audio-listen';
import { createJobsSandbox } from './template-sandbox';
import { reelSubjects } from './template-subjects';
import type { VisionWiring } from './vision';

/** Test builds: the beat stand-in, or undefined when stand-ins are off (always in a release build). */
function standinBeats(media: () => ReturnType<MediaService['binaries']>, container: Container) {
  if (__TAALCUT_FLAVOUR__ !== 'test' || process.env.TAALCUT_TEST_STANDIN_ANALYSERS !== '1') return undefined;
  return async (): Promise<BreakdownAudio['beats']> => {
    const { standinBeats: beats } = await import('./template-standins');
    return beats(async () => {
      const binaries = await media();
      return binaries.ok ? ok({ binaries: binaries.value, ...sessionContext(container) }) : binaries;
    });
  };
}

export function templateJobs(
  config: UtilityConfig,
  container: Container,
  media: MediaService,
  vision: VisionWiring,
): JobRegistration[] {
  const log = (message: string) => console.warn(message);
  const components = () => container.resolve(ComponentManagerToken);
  const onFallback = (event: Parameters<VisionWiring['onFallback']>[0]) => vision.onFallback(event);
  // One media context for every step: hardware failures and the tone-map choice are paid for once.
  const shared = { hardwareFailures: new HardwareFailures(), toneMaps: new ToneMapSelection() };
  const mediaContext = async () => {
    const binaries = await media.binaries();
    if (!binaries.ok) return binaries;
    // The app-wide cap on hardware video sessions, as media's and vision's FFmpeg calls have it.
    const ctx: MediaContext = {
      binaries: binaries.value,
      onComputeFallback: onFallback,
      ...shared,
      ...sessionContext(container),
    };
    return ok(ctx);
  };
  const standins = standinBeats(() => media.binaries(), container);

  const sandbox = createJobsSandbox({
    config,
    media,
    components,
    log,
    ...(container.has(HardwareSessionsToken)
      ? { hardwareSessions: container.resolve(HardwareSessionsToken) }
      : {}),
  });
  const context = { media: mediaContext, onFallback };
  const jobs = createTemplateJobs({
    sandbox,
    components: {
      install: (id, options) => components().install(id, options),
      get: (id) => components().get(id),
    },
    clock: container.resolve(ClockToken),
    log,
    analysers: {
      media: breakdownMedia(context),
      vision: {
        ...breakdownVision({
          ...context,
          embedder: vision.embedder,
          ocr: vision.ocr,
          // Never in a test build with stand-ins: those run offline.
          ...(standins
            ? {}
            : {
                installEmbedder: (signal: AbortSignal) =>
                  components().install(EMBEDDING_COMPONENT, { signal }),
              }),
        }),
        // FRM1-SUB: where the reel's people are, on the mac helper.
        subjects: reelSubjects(macHelpers(config), container),
        // FRM1-MOT: the camera's measured move.
        ...cameraMotionAnalyser(context),
      },
      audio: breakdownAudio({
        media: mediaContext,
        components,
        onFallback,
        beatPlan: machineBeatPlan(macHardware(config.userData), componentsRoot(config.userData), log),
        log,
        ...(standins ? { standinBeats: standins } : {}),
        // EAR1-C1: the reel heard by the listen service audio-listen.ts registers in this process.
        listen: () => (container.has(ListenServiceToken) ? container.resolve(ListenServiceToken) : undefined),
      }),
    },
  });
  return [...createSandboxJobs(sandbox), ...jobs];
}
