// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `predict:shots` on the decode route the app takes (IX3-R1). Where the decode switch gives the analysis pass to the
 * decode service (`TAALCUT_DECODE_SERVICE`, read as the search harness reads it: eval-decode.ts), each clip goes
 * through vision's shots job (`vision.detectShots`) as the jobs process runs it: the job opens the asset's frame
 * source with the service, so the pass, and the small RGB stream TransNetV2 reads from it, are the service's
 * decode. (`detectShots` called on its own opens a frame source without a service: FFmpeg's pass.)
 *
 * The job keeps the frames OCR reads only in a process that has an OCR engine, as the app's has on a Mac, so the
 * routed Apple Vision engine is given as the app wires it: made on first use, which the shots job never asks for,
 * so no OCR process starts. Whose pass decoded each clip (a file the service declines goes to FFmpeg, as in the
 * app) is kept, for the run's log.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, ok, type AsyncResult, type JobContext } from '@taalcut/core';
import {
  createJsonLineSidecar,
  createSidecarResolver,
  serviceFor,
  type DecodeService,
  type SidecarResolver,
} from '@taalcut/media';
import {
  createAppleVisionOcr,
  createRoutedOcr,
  indexJobRegistrations,
  lazyOcrEngine,
  visionDetectShotsJob,
  type DetectShotsDeps,
  type DetectShotsResult,
  type ShotsContext,
  type VisionJobDeps,
} from '@taalcut/vision';
import { decodeServiceTook, evalDecodeService, type EvalDecodeOptions } from '../search/eval-decode';

/** What `predict:shots` reads of a clip's shots. */
export type RoutedShots = Pick<DetectShotsResult, 'detector' | 'cuts'>;

/** Whose pass decoded a clip, for its log line. */
export type PassDecoder = 'the decode service' | 'FFmpeg, the service declined' | 'FFmpeg';

export interface ShotsRoute {
  /** What the decode service takes under the switch (`pass and frames`), for the run's log. */
  readonly took: string;
  /** One clip through the shots job, with the detector's model, embedder and fallback log. */
  detect(path: string, deps: DetectShotsDeps, ctx: ShotsContext): AsyncResult<RoutedShots>;
  /** Whose pass decoded `path` last: the service's, or FFmpeg's (the service declined it, or wasn't asked). */
  passOf(path: string): PassDecoder;
  close(): Promise<void>;
}

export interface ShotsRouteOptions {
  /** The footage set's folder: the helper may read it. */
  readonly footageDir: string;
  /** Tests: where the switch is read, and the helper found. Default: this process and the checkout's build. */
  readonly decode?: EvalDecodeOptions;
  /** Tests: the shots job's handler. Default: vision's. */
  readonly jobs?: (deps: VisionJobDeps) => ReturnType<typeof indexJobRegistrations>;
  readonly log: (line: string) => void;
}

/**
 * The service, with each file's last pass outcome kept: true when the service decoded it, false when it declined or
 * failed (the pass then runs on FFmpeg, as in the app). A file it was never asked for (helper-eligible.ts) has none.
 */
export function recordingPasses(service: DecodeService, outcomes: Map<string, boolean>): DecodeService {
  return {
    id: service.id,
    ...(service.tasks ? { tasks: service.tasks } : {}),
    async pass(request, options) {
      const report = await service.pass(request, options);
      outcomes.set(request.path, report.ok);
      return report;
    },
    frames: (request, options) => service.frames(request, options),
    avoid: (path, reason) => service.avoid(path, reason),
    avoided: (path) => service.avoided(path),
    close: () => service.close(),
  };
}

/** The routed OCR engine as the app wires it on a Mac (Apple Vision in the helper), made on first use only. */
function appOcr(tempDir: string, resolver: Pick<SidecarResolver, 'resolve'>) {
  return createRoutedOcr({
    vision: lazyOcrEngine(async () => {
      const helper = await resolver.resolve();
      if (!helper.ok) return helper;
      const sidecar = createJsonLineSidecar({
        command: helper.value.path,
        args: ['serve', '--services', 'ocr', '--allow-root', tempDir],
      });
      return ok(createAppleVisionOcr(sidecar, { tempDir }));
    }, 'en'),
  });
}

function jobContext(ctx: ShotsContext): JobContext {
  return {
    jobId: newId<'Job'>(),
    projectId: null,
    attempt: 1,
    signal: ctx.signal ?? new AbortController().signal,
    progress: ({ fraction }) => {
      if (fraction !== null) ctx.progress?.(fraction);
    },
  };
}

/**
 * The service's route, or undefined when the switch leaves the analysis pass to FFmpeg (no service, or one that
 * takes the frame reads only): `detectShots` then decodes as the app does under that setting.
 */
export async function openShotsRoute(options: ShotsRouteOptions): Promise<ShotsRoute | undefined> {
  const tempDir = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-shots-route-')));
  const opened = await evalDecodeService([options.footageDir, tempDir], {
    log: options.log,
    ...options.decode,
  });
  if (!opened || !serviceFor(opened, 'pass')) {
    await opened?.close();
    await rm(tempDir, { recursive: true, force: true });
    options.log('analysis pass on FFmpeg');
    return undefined;
  }
  const outcomes = new Map<string, boolean>();
  const service = recordingPasses(opened, outcomes);
  const took = decodeServiceTook(service.tasks ?? []);
  options.log(`analysis pass on the decode service (it takes ${took})`);
  const resolver =
    options.decode?.resolver ??
    createSidecarResolver({ name: 'taalcut-mac-helper', development: true, pin: '', env: process.env });
  const ocr = appOcr(tempDir, resolver);
  const jobs = options.jobs ?? indexJobRegistrations;
  return {
    took,
    async detect(path, deps, ctx) {
      const registration = jobs({
        media: deps.media,
        tier: 'recommended',
        tempDir,
        decodeService: service,
        ocr,
        ...(deps.embedder ? { embedder: deps.embedder } : {}),
        ...(deps.boundaryModel ? { boundaryModel: deps.boundaryModel } : {}),
        ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
      }).find((job) => job.kind.kind === visionDetectShotsJob.kind);
      if (!registration) throw new Error(`no handler for ${visionDetectShotsJob.kind}`);
      const ran = await registration.handler({ assetId: randomUUID(), path }, jobContext(ctx));
      if (!ran.ok) return ran;
      const output = visionDetectShotsJob.output.safeParse(ran.value);
      if (!output.success)
        throw new Error(`${path}: the shots job's output didn't parse: ${output.error.message}`);
      const { detector, cuts } = output.data;
      // Every shots job since IX2-S7 says which detector decided; one that doesn't can't be scored as either.
      if (detector === undefined) throw new Error(`${path}: the shots job didn't say which detector decided`);
      return ok({ detector, cuts });
    },
    passOf(path) {
      const decoded = outcomes.get(path);
      if (decoded === undefined) return 'FFmpeg';
      return decoded ? 'the decode service' : 'FFmpeg, the service declined';
    },
    async close() {
      await ocr.close?.();
      await service.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
