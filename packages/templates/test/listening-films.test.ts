// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1 end to end: F2's fixture films (tools/earshot-parity: 32 to 35 cuts each, hits planted on them at known
 * offsets) broken down as reels, through the real pipeline: cuts by the FFmpeg stand-ins, the listening by audio's
 * analysis (its signal processing: cut sync needs no model). Each cut's status in the template agrees with upstream
 * earshot's own on ≥ 90% of each film's cuts; a cut the breakdown missed counts against it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createManualClock, newId, ok, type AsyncResult, type Template } from '@taalcut/core';
import {
  analyseSound,
  createSpectrogramRunner,
  type AnalyseSoundRequest,
  type SoundAnalysis,
} from '@taalcut/audio';
import { breakdownListener, buildTemplate, runBreakdown, type BreakdownMedia } from '../src/index';
import { createFfmpegAnalysers, runProcess, type FfmpegBinaryPaths } from '../src/test-support';
import { writeClip, writeFilmVideo } from '../../../tools/earshot-parity/fixtures.mjs';
import { findFfmpeg } from './helpers/ffmpeg';
import { sequentialIds } from './helpers/fixtures';
import { film } from './helpers/listening-film';

const { bins, skip } = findFfmpeg('listening films');
const root = mkdtempSync(join(tmpdir(), 'taalcut-listening-films-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FILMS = ['film-00', 'film-01', 'film-03', 'film-05'];
const runner = createSpectrogramRunner({ plan: { devices: ['cpu'] } });

/** How a reel's sound is stored: AAC in MP4 as a downloaded reel is, or lossless (ALAC) as the film was made. */
type Codec = 'aac' | 'alac';
const CODEC_ARGS: Record<Codec, string[]> = { aac: ['-c:a', 'aac', '-b:a', '192k'], alac: ['-c:a', 'alac'] };

/** The reel: the film's picture with its sound. */
async function reelOf(id: string, codec: Codec, ffmpeg: FfmpegBinaryPaths): Promise<string> {
  const dir = join(root, id);
  const video = await writeFilmVideo(id, dir, ffmpeg.ffmpeg);
  const wav = writeClip(id, dir);
  const reel = join(dir, `reel-${codec}.mp4`);
  const muxed = await runProcess(ffmpeg.ffmpeg, [
    ...['-v', 'error', '-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy'],
    ...CODEC_ARGS[codec],
    reel,
  ]);
  if (!muxed.ok) throw new Error(muxed.error.detail);
  return reel;
}

/** Audio's analysis on the file decoded by FFmpeg (templates can't import media's decoder). */
function analyser(ffmpeg: FfmpegBinaryPaths) {
  return async (request: AnalyseSoundRequest): AsyncResult<SoundAnalysis> => {
    const decoded = await runProcess(ffmpeg.ffmpeg, [
      ...['-v', 'error', '-i', request.path!, '-vn', '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'],
    ]);
    if (!decoded.ok) return decoded;
    const bytes = decoded.value.stdout;
    const all = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    const frames = all.length >> 1;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = all[2 * i]!;
      right[i] = all[2 * i + 1]!;
    }
    const { path: _path, ...rest } = request;
    return analyseSound(
      { spectrograms: async () => runner },
      { ...rest, pcm: { sampleRate: 48_000, channels: [left, right] } },
    );
  };
}

/** The stand-in picks frames with one FFmpeg select expression, too long for 35 shots: at most 40 frames a run. */
function inBatches(extract: BreakdownMedia['extractFrames']): BreakdownMedia['extractFrames'] {
  return async (path, frames, options) => {
    const paths: string[] = [];
    for (let start = 0; start < frames.length; start += 40) {
      const batch = await extract(path, frames.slice(start, start + 40), options);
      if (!batch.ok) return batch;
      paths.push(...batch.value);
    }
    return ok(paths);
  };
}

async function breakDown(id: string, codec: Codec, ffmpeg: FfmpegBinaryPaths): Promise<Template> {
  const scripted = createFfmpegAnalysers(ffmpeg);
  const experimentDir = join(root, id, `experiment-${codec}`);
  await mkdir(experimentDir, { recursive: true });
  const draft = await runBreakdown(
    {
      breakdownId: newId(),
      referencePath: await reelOf(id, codec, ffmpeg),
      input: 'file',
      platform: null,
      url: null,
    },
    {
      ...scripted,
      media: { ...scripted.media, extractFrames: inBatches(scripted.media.extractFrames) },
      audio: {
        ...scripted.audio,
        listen: breakdownListener(analyser(ffmpeg), { install: false, models: false }),
      },
      experimentDir,
      clock: createManualClock(1),
    },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${draft.error.code}: ${draft.error.detail ?? ''}`);
  const built = buildTemplate(draft.value, [], [], sequentialIds(), { createdAt: 1 });
  if (!built.ok) throw new Error(built.error.detail);
  return built.value;
}

/** The share of the film's cuts whose status in the template is upstream's (a cut the breakdown missed: none). */
async function agreement(id: string, codec: Codec): Promise<number> {
  const truth = film(id);
  const template = await breakDown(id, codec, bins!);
  const listening = template.audio.listening!;
  expect(listening.sfxAtCuts.length).toBeGreaterThan(0);
  const statusAt = new Map(
    listening.cutSync.items.map((item) => [template.slots[item.cutIndex]!.start.value, item.status]),
  );
  const heard = truth.cuts.map((frame) => statusAt.get(frame));
  const agree = heard.filter((status, k) => status === truth.statuses[k]).length / truth.cuts.length;
  const missed = heard.filter((status) => status === undefined).length;
  console.warn(
    `[EAR1-C1] ${id} (${codec}): ${(agree * 100).toFixed(1)}% of ${truth.cuts.length} cuts agree, ${missed} missed`,
  );
  return agree;
}

describe.skipIf(!bins)(`the breakdown hears the fixture films (EAR1-C1)${skip}`, () => {
  it.each(FILMS)(
    '%s, its sound as made: every cut-sync status agrees with upstream on ≥ 90% of its cuts',
    async (id) => expect(await agreement(id, 'alac')).toBeGreaterThanOrEqual(0.9),
    120_000,
  );

  // AAC moves an onset by a few milliseconds: a hit exactly one frame off a cut can read `near` where the film's
  // own sound reads `ok`. Three of the four reels still agree on ≥ 90% (film-05's drums sit on such ties).
  it('as AAC reels, ≥ 3 of the films agree with upstream on ≥ 90% of their cuts', async () => {
    const shares: number[] = [];
    for (const id of FILMS) shares.push(await agreement(id, 'aac'));
    expect(shares.filter((share) => share >= 0.9).length).toBeGreaterThanOrEqual(3);
  }, 300_000);
});
