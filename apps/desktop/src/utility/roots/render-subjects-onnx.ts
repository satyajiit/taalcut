// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: `render.trackSubjects` without the mac helper (Linux and Windows): a shot's frames through vision's ONNX
 * detector (RTMO-s poses, YOLOX-Nano people) as core's SubjectTrack, with ONNX_TRACK_RECIPE, so `SubjectSource`
 * works there too. The `subjects-onnx` component is installed on first use. One detector per process, opened on the
 * first shot; the runtime reports its own CPU fallback (`compute.fallback`).
 */
import {
  err,
  ok,
  subjectTrackSchema,
  ValidationError,
  type AsyncResult,
  type Container,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import { createMediaService, HardwareFailures, ToneMapSelection, type MediaContext } from '@taalcut/media';
import { ONNX_TRACK_RECIPE, type SubjectTracker } from '@taalcut/render';
import {
  createOnnxSubjectDetector,
  createOrtRuntime,
  detectSubjectsAlong,
  SUBJECTS_ONNX_COMPONENT,
  type OnnxRuntime,
  type SubjectDetector,
} from '@taalcut/vision';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ComponentManagerToken } from '../../shared/tokens';
import { sessionContext } from './hardware-sessions';
import { mediaBinaries } from './media-jobs';

export interface OnnxTrackerDeps {
  readonly media: () => AsyncResult<MediaContext>;
  /** The installed `subjects-onnx` folder, installed first when it isn't. */
  readonly modelDir: (signal?: AbortSignal) => AsyncResult<string>;
  readonly runtime: () => OnnxRuntime;
}

export function onnxTracker(deps: OnnxTrackerDeps): SubjectTracker {
  let opened: { readonly dir: string; readonly detector: SubjectDetector } | undefined;
  const detectorFor = async (dir: string) => {
    if (opened?.dir === dir) return opened.detector;
    await opened?.detector.release();
    opened = { dir, detector: createOnnxSubjectDetector({ runtime: deps.runtime(), modelDir: dir }) };
    return opened.detector;
  };
  return {
    async track(input) {
      try {
        const media = await deps.media();
        if (!media.ok) return media;
        const dir = await deps.modelDir(input.signal);
        if (!dir.ok) return dir;
        const along = await detectSubjectsAlong(
          {
            path: input.path,
            range: input.range,
            detectHz: ONNX_TRACK_RECIPE.detectHz,
            shortSide: ONNX_TRACK_RECIPE.shortSide,
            ...(input.signal ? { signal: input.signal } : {}),
          },
          { media: media.value, detector: await detectorFor(dir.value) },
        );
        if (!along.ok) return along;
        const track = subjectTrackSchema.safeParse({
          version: 1,
          assetId: input.assetId,
          contentHash: input.contentHash,
          range: input.range,
          recipe: ONNX_TRACK_RECIPE,
          frame: along.value.frame,
          compute: {},
          samples: along.value.samples,
        });
        if (!track.success)
          return err(ValidationError({ field: 'subjects' }, { detail: track.error.message }));
        // The runtime already reported a CPU fallback as it opened the sessions.
        return ok({ track: track.data, cpu: [] });
      } finally {
        // No helper session: FFmpeg's decodes ended with the samples.
        input.onLetGo?.();
      }
    },
  };
}

/** The jobs process's ONNX tracker: its own media binaries, the component manager, a WebGPU-then-CPU runtime. */
export function desktopOnnxTracker(
  config: UtilityConfig,
  container: Container,
  onFallback: (event: ComputeFallbackEvent) => void,
): SubjectTracker {
  const service = createMediaService({ resolver: mediaBinaries(config) });
  const shared = { hardwareFailures: new HardwareFailures(), toneMaps: new ToneMapSelection() };
  let runtime: OnnxRuntime | undefined;
  return onnxTracker({
    media: async () => {
      const binaries = await service.binaries();
      if (!binaries.ok) return binaries;
      return ok({
        binaries: binaries.value,
        onComputeFallback: onFallback,
        ...shared,
        ...sessionContext(container),
      });
    },
    modelDir: async (signal) => {
      const components = container.resolve(ComponentManagerToken);
      const present = await components.get(SUBJECTS_ONNX_COMPONENT);
      if (present) return ok(present.path);
      const installed = await components.install(SUBJECTS_ONNX_COMPONENT, signal ? { signal } : {});
      return installed.ok ? ok(installed.value.path) : installed;
    },
    runtime: () => (runtime ??= createOrtRuntime({ onFallback })),
  });
}
