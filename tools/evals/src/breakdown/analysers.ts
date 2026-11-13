// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysers the breakdown eval runs @taalcut/templates' pipeline on.
 * Real where the eval can run the real thing offline: the probe and the
 * loudness are @taalcut/media's; method A (scdet scene scores) and the frame
 * sampling are @taalcut/vision's; the media steps run on the app's FFmpeg
 * (ffmpeg-steps.ts). Two stand-ins, because their models are components the
 * eval has no download for: method B's frame "embedding" is a 12×12 colour
 * thumbnail, not EmbeddingGemma 2, and beats are click onsets
 * (silencedetect), not Beat This!. No OCR or speech (mac helper, speech
 * models). Every report made with these says synthetic.
 */
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  UnknownError,
  type AsyncResult,
  type BeatMap,
} from '@taalcut/core';
import { measureLoudness, probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import type { BreakdownAnalysers, ReferenceProbe } from '@taalcut/templates';
import { probeSource, sampleFrames, sceneScores, type VideoSource } from '@taalcut/vision';
import { contactSheet, extractFrames, lumaCurve, normalise } from './ffmpeg-steps';

const THUMB = 12;
const BEAT_RATE = FrameRate.of(100);
const SCENE_LONG_SIDE = 256;

async function probe(ctx: MediaContext, path: string, signal: AbortSignal): AsyncResult<ReferenceProbe> {
  const probed = await probeMedia(path, ctx, { signal });
  if (!probed.ok) return probed;
  const video = probed.value.video;
  const rate = video?.frameRate ? FrameRate.of(video.frameRate.num, video.frameRate.den) : FrameRate.of(30);
  const seconds = probed.value.duration ? probed.value.duration.value / probed.value.duration.rate : 0;
  return ok({
    duration: RationalTime.fromSeconds(seconds, rate),
    rate,
    width: video?.displayWidth ?? 0,
    height: video?.displayHeight ?? 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(probed.value.audio),
  });
}

/** Each channel value as an angle on a half circle: every vector has one length, distance is picture change. */
function thumbVector(data: Uint8Array): Float32Array {
  const vector = new Float32Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    const angle = (data[i]! / 255) * Math.PI;
    vector[2 * i] = Math.cos(angle);
    vector[2 * i + 1] = Math.sin(angle);
  }
  return vector;
}

/** Click onsets as a beat map: the stand-in for Beat This! on reels made with a click track. */
async function clickBeats(ctx: MediaContext, path: string, signal: AbortSignal): AsyncResult<BeatMap | null> {
  const log: Buffer[] = [];
  const run = await runFfmpeg(
    ctx,
    ['-v', 'info', '-i', path, '-vn', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'],
    { signal, onStderr: (chunk) => log.push(chunk) },
  );
  if (!run.ok) return run;
  const text = Buffer.concat(log).toString('utf8');
  const onsets = [...text.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
  const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  // A click at 0 has no silence before it.
  if (starts[0] !== undefined && starts[0] > 0 && starts[0] < 0.05) onsets.unshift(0);
  const ticks = [...new Set(onsets.map((t) => Math.round(t * 100)))].sort((a, b) => a - b);
  if (ticks.length < 2) return ok(null);
  const gaps = ticks
    .slice(1)
    .map((t, i) => t - ticks[i]!)
    .sort((a, b) => a - b);
  return ok({
    rate: BEAT_RATE,
    beats: ticks.map((t) => RationalTime.of(t, BEAT_RATE)),
    downbeats: ticks.map((_, i) => i).filter((i) => i % 4 === 0),
    bpm: Math.round(6000 / gaps[gaps.length >> 1]!),
    beatsPerBar: 4,
    confidence: 1,
    source: 'tracker',
  });
}

export function evalBreakdownAnalysers(ctx: MediaContext): BreakdownAnalysers {
  const sources = new Map<string, AsyncResult<VideoSource>>();
  const source = (path: string, signal: AbortSignal) => {
    let found = sources.get(path);
    if (!found) {
      found = probeSource(ctx, path, signal);
      sources.set(path, found);
    }
    return found;
  };
  const thumbs = new Map<string, Float32Array[]>();

  async function allThumbs(
    path: string,
    video: VideoSource,
    signal: AbortSignal,
  ): AsyncResult<Float32Array[]> {
    const cached = thumbs.get(path);
    if (cached) return ok(cached);
    const sampled = await sampleFrames(ctx, video, {
      size: { width: THUMB, height: THUMB },
      format: 'rgb24',
      every: 1,
      signal,
    });
    if (!sampled.ok) return sampled;
    const vectors = sampled.value.map((frame) => thumbVector(frame.data));
    thumbs.set(path, vectors);
    return ok(vectors);
  }

  return {
    media: {
      probe: (path, { signal }) => probe(ctx, path, signal),
      normalise: normalise(ctx),
      extractFrames: extractFrames(ctx),
      contactSheet: contactSheet(ctx),
      lumaCurve: lumaCurve(ctx),
    },
    vision: {
      async sceneScores(path, { signal }) {
        const video = await source(path, signal);
        if (!video.ok) return video;
        const samples = await sceneScores(ctx, video.value, { every: 1, longSide: SCENE_LONG_SIDE, signal });
        if (!samples.ok) return samples;
        const scores: number[] = [];
        for (const sample of samples.value) scores[sample.index] = sample.score;
        return ok(Array.from(scores, (score) => score ?? 0));
      },
      async frameEmbeddings(path, frames, { signal }) {
        const video = await source(path, signal);
        if (!video.ok) return video;
        const all = await allThumbs(path, video.value, signal);
        if (!all.ok) return all;
        if (all.value.length === 0)
          return err(UnknownError(undefined, { detail: `no frames sampled from ${path}` }));
        return ok(frames.map((frame) => all.value[Math.min(frame, all.value.length - 1)]!));
      },
    },
    audio: {
      beats: async (path, { signal }) => {
        const beatMap = await clickBeats(ctx, path, signal);
        return beatMap.ok ? ok({ beatMap: beatMap.value }) : beatMap;
      },
      async loudness(path, { signal }) {
        const reading = await measureLoudness(path, ctx, { signal });
        if (!reading.ok) return reading;
        const lufs = reading.value.integratedLufs;
        // ebur128 reports -70 LUFS (its gate) for silence.
        return ok({ integratedLufs: !Number.isFinite(lufs) || lufs <= -70 ? null : lufs });
      },
    },
  };
}
