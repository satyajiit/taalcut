// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The store as media's speech-PCM port (IX-D4, IX-A1): the waveform takes its peaks from the asset's one audio
 * pass in whatever order it runs against language ID and the transcript.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err } from '@taalcut/core';
import { MediaCancelled, type NormalisationPlan } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssetAudioStore, type AssetAudioStore } from '../../src/asset-audio/asset-audio-store';
import { speechPcmPort } from '../../src/asset-audio/speech-pcm-port';
import { audioPlan, fakePassFfmpeg } from '../helpers/audio-pass';

let parent = '';

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'taalcut-speech-port-'));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

const plan: NormalisationPlan = { ...audioPlan(2000), kind: 'video' };
const asset = { path: '/clips/a.mov', contentHash: 'b'.repeat(64), plan };

/** language ID keeps the PCM for the transcript; the transcript removes it (audio's index handlers). */
async function languageThenTranscript(store: AssetAudioStore, ctx: ReturnType<typeof fakePassFfmpeg>['ctx']) {
  const language = await store.acquire(asset, ctx);
  if (!language.ok) throw new Error(language.error.code);
  await language.value.release({ keep: true });
  const transcript = await store.acquire(asset, ctx);
  if (!transcript.ok) throw new Error(transcript.error.code);
  await transcript.value.release();
}

describe('speech-PCM port over the asset audio store', () => {
  it('gives the waveform after the transcript the kept peaks: one audio pass', async () => {
    const ffmpeg = fakePassFfmpeg({ frames: 32_000 });
    const store = createAssetAudioStore({ parent, keepPeaks: true });
    await languageThenTranscript(store, ffmpeg.ctx);
    // The transcript removed the PCM.
    expect(await readdir(store.root)).toEqual([]);

    const peaks = await speechPcmPort(() => store).peaks(asset, ffmpeg.ctx);
    if (!peaks.ok) throw new Error(peaks.error.code);
    // 2 s at 100 buckets a second (the count after the version and rate).
    expect(peaks.value.readUInt32LE(8)).toBe(200);
    expect(ffmpeg.calls()).toBe(1);
    expect(store.stats()).toMatchObject({ passes: 1, entries: 0 });
  });

  it('between language ID and the transcript: the kept peaks, and the transcript still reads the PCM', async () => {
    const ffmpeg = fakePassFfmpeg();
    const store = createAssetAudioStore({ parent, keepPeaks: true });
    const language = await store.acquire(asset, ffmpeg.ctx);
    if (!language.ok) throw new Error(language.error.code);
    await language.value.release({ keep: true });
    const peaks = await speechPcmPort(() => store).peaks(asset, ffmpeg.ctx);
    expect(peaks.ok).toBe(true);
    const transcript = await store.acquire(asset, ffmpeg.ctx);
    expect(transcript.ok).toBe(true);
    if (transcript.ok) await transcript.value.release();
    expect(ffmpeg.calls()).toBe(1);
  });

  it('before language ID: the waveform runs the pass and leaves it for language ID', async () => {
    const ffmpeg = fakePassFfmpeg();
    const store = createAssetAudioStore({ parent, keepPeaks: true });
    const peaks = await speechPcmPort(() => store).peaks(asset, ffmpeg.ctx);
    expect(peaks.ok).toBe(true);
    await languageThenTranscript(store, ffmpeg.ctx);
    expect(ffmpeg.calls()).toBe(1);
    // Language ID and the transcript both reuse the waveform's pass.
    expect(store.stats()).toMatchObject({ passes: 1, reused: 2, entries: 0 });
  });

  it('keeps no peaks for an audio file (it has no waveform stage) or without keepPeaks', async () => {
    for (const [ref, keepPeaks] of [
      [{ ...asset, plan: audioPlan(2000) }, true],
      [asset, false],
    ] as const) {
      const ffmpeg = fakePassFfmpeg();
      const store = createAssetAudioStore({ parent, keepPeaks });
      const language = await store.acquire(ref, ffmpeg.ctx);
      if (!language.ok) throw new Error(language.error.code);
      await language.value.release();
      // Nothing kept: a waveform now would need a pass of its own.
      expect((await store.peaks(ref, ffmpeg.ctx)).ok).toBe(true);
      expect(ffmpeg.calls()).toBe(2);
      await store.close();
    }
  });

  it('passes a failed pass through, so the waveform decodes the audio itself', async () => {
    const port = speechPcmPort(() => ({ peaks: async () => err(MediaCancelled()) }));
    const peaks = await port.peaks(asset, fakePassFfmpeg().ctx);
    expect(peaks.ok).toBe(false);
    if (!peaks.ok) expect(peaks.error.code).toBe('media.cancelled');
  });

  it('looks the store up on each call (the app makes it on the first indexing job)', async () => {
    let lookups = 0;
    const store = createAssetAudioStore({ parent, keepPeaks: true });
    const port = speechPcmPort(() => {
      lookups += 1;
      return store;
    });
    expect(lookups).toBe(0);
    expect((await port.peaks(asset, fakePassFfmpeg().ctx)).ok).toBe(true);
    expect(lookups).toBe(1);
  });
});
