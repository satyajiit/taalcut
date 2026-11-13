// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1: the breakdown's listening as the jobs process composes it (template-audio.ts over audio-listen.ts's
 * listen service), on an F2 fixture film made into a reel (tools/earshot-parity). Without the CLAP and AST
 * components a test build never downloads them: the stage completes with `listening_unavailable`. With the models
 * (TAALCUT_EAR1_MODELS, as audio's EAR1 suites) the reel is heard whole: sections, key, the cut sync, the effects on
 * its cuts and its own critique metrics (K1).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { FrameRate, ok, RationalTime, type ComputeFallbackEvent } from '@taalcut/core';
import {
  createListenService,
  DEFAULT_BEAT_PLAN,
  directoryListenFiles,
  FILM_METRIC_IDS,
  installedListenFiles,
  type ListenService,
} from '@taalcut/audio';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { LISTENING_UNAVAILABLE, listenToReel } from '@taalcut/templates';
import { clip, cliRun, writeClip, writeFilmVideo } from '../../../tools/earshot-parity/fixtures.mjs';
import { breakdownAudio } from '../src/utility/roots/template-audio';
import { noComponents } from './helpers/breakdown-fakes';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('template audio listen');
const MODELS = process.env.TAALCUT_EAR1_MODELS?.replace(/^~(?=\/)/, process.env.HOME ?? '~');
const root = mkdtempSync(join(tmpdir(), 'taalcut-desktop-listen-'));
const services: ListenService[] = [];
afterAll(async () => {
  for (const service of services) await service.release();
  rmSync(root, { recursive: true, force: true });
});

const FILM = 'film-01';
const RATE = FrameRate.of(30);

async function reel(media: MediaContext): Promise<string> {
  const video = await writeFilmVideo(FILM, root, media.binaries.ffmpeg);
  const wav = writeClip(FILM, root);
  const path = join(root, 'reel.mp4');
  const muxed = await runFfmpeg(media, [
    ...['-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy'],
    ...['-c:a', 'aac', '-b:a', '192k', path],
  ]);
  if (!muxed.ok) throw new Error(muxed.error.detail);
  return path;
}

function audioWith(media: MediaContext, service: ListenService, testBuild: boolean) {
  const fallbacks: ComputeFallbackEvent[] = [];
  return breakdownAudio({
    media: async () => ok(media),
    components: () => noComponents,
    onFallback: (event) => void fallbacks.push(event),
    beatPlan: async () => DEFAULT_BEAT_PLAN,
    // A test build with stand-ins: never downloads a model.
    ...(testBuild ? { standinBeats: async () => async () => ok({ beatMap: null }) } : {}),
    listen: () => service,
  });
}

const truthCuts = () => (clip(FILM).truth.cuts ?? []).map((t) => Math.round(t * RATE.num));

describe.skipIf(!resolved.ok)('the breakdown hears the reel through the jobs root (EAR1-C1)', () => {
  const media = (): MediaContext => ({ binaries: resolved.ok ? resolved.value : (undefined as never) });

  it(
    'completes without the models: listening_unavailable, never a download',
    { timeout: 120_000 },
    async () => {
      const installs: string[] = [];
      const service = createListenService({
        media: async () => ok(media()),
        files: installedListenFiles({
          get: async () => undefined,
          install: async (id) => (installs.push(id), noComponents.install(id)),
        }),
        plan: async () => ({ devices: ['cpu'] }),
      });
      services.push(service);
      const audio = audioWith(media(), service, true);
      const heard = await audio.listen!({
        path: await reel(media()),
        cuts: truthCuts().map((frame) => RationalTime.of(frame, RATE)),
        frameRate: RATE,
        signal: new AbortController().signal,
      });
      expect(heard.ok ? 'heard' : heard.error.code).toBe('audio.listen_model_missing');
      expect(installs).toEqual([]);
      const outcome = await listenToReel(audio, {
        path: join(root, 'reel.mp4'),
        cuts: truthCuts(),
        rate: RATE,
        beatMap: null,
        hasAudio: true,
        signal: new AbortController().signal,
      });
      expect(outcome).toEqual({ listening: null, warning: LISTENING_UNAVAILABLE });
    },
  );

  it.skipIf(!MODELS)(
    'with the models: sections, key and tempo, the cut sync, the effects on the cuts and the K1 metrics',
    { timeout: 300_000 },
    async () => {
      const service = createListenService({
        media: async () => ok(media()),
        files: directoryListenFiles(MODELS ?? '', 'fp16'),
      });
      services.push(service);
      const audio = audioWith(media(), service, false);
      const path = await reel(media());
      const started = performance.now();
      const outcome = await listenToReel(audio, {
        path,
        cuts: truthCuts(),
        rate: RATE,
        beatMap: null,
        hasAudio: true,
        signal: new AbortController().signal,
      });
      const ms = performance.now() - started;
      const listening = outcome.listening!;
      expect(outcome.warning).toBeUndefined();
      expect(listening.model).toMatchObject({ dtype: 'fp16' });
      expect(listening.sections.length).toBeGreaterThan(0);
      expect(listening.measures.tempo?.bpm).toBeGreaterThan(0);
      expect(Object.keys(listening.critiqueMetrics ?? {}).sort()).toEqual([...FILM_METRIC_IDS].sort());
      const upstream = cliRun<{ sync: { cuts: { items: { status: string }[] } } }>('timeline', FILM).sync.cuts
        .items;
      const names: Record<string, string> = { OK: 'ok', 'no sound': 'none' };
      const agree =
        listening.cutSync.items.filter(
          (item) =>
            (names[upstream[item.cutIndex]!.status] ?? upstream[item.cutIndex]!.status) === item.status,
        ).length / upstream.length;
      console.warn(
        `MEASURE ear1-c1-listen ${FILM}: ${Math.round(ms)} ms, ${(agree * 100).toFixed(1)}% statuses agree, ` +
          `${listening.sfxAtCuts.length} effects, ${listening.sections.length} sections`,
      );
      expect(agree).toBeGreaterThanOrEqual(0.9);
      expect(listening.sfxAtCuts.length).toBeGreaterThan(0);
    },
  );
});
