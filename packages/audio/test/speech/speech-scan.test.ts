// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The language-ID window and the voice scan over a speech PCM, with a VAD that hears loud windows (IX-A2). */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSpeechPcm, writePcmRange, type SpeechPcm } from '../../src/asset-audio/wav-file';
import { languageWindow } from '../../src/speech/language-window';
import { scanSpeech } from '../../src/speech/speech-scan';
import { wavOf } from '../helpers/audio-pass';
import { loudnessVad } from '../helpers/fake-vad';

const RATE = 16_000;
let dir = '';

/** Loud (voice) where `voiced(ms)` says so, digital silence elsewhere. */
async function pcmOf(name: string, seconds: number, voiced: (ms: number) => boolean): Promise<SpeechPcm> {
  const path = join(dir, `${name}.wav`);
  const frames = seconds * RATE;
  await writeFile(
    path,
    wavOf((i) => (voiced((i * 1000) / RATE) ? Math.round(8000 * Math.sin(i / 5)) : 0), frames),
  );
  const pcm = await readSpeechPcm(path);
  if (!pcm.ok) throw new Error(pcm.error.code);
  return pcm.value;
}

const OPTIONS = { windowMs: 30_000, enoughSpeechMs: 10_000, padMs: 250 };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-speech-scan-'));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('language window', () => {
  it('picks the span with the most voice, earliest on a tie, trimmed to its voice', () => {
    const speech = [
      { startMs: 1000, endMs: 3000 },
      { startMs: 40_000, endMs: 52_000 },
      { startMs: 60_000, endMs: 66_000 },
      { startMs: 100_000, endMs: 101_000 },
    ];
    expect(languageWindow(speech, { windowMs: 30_000, durationMs: 120_000, padMs: 250 })).toEqual({
      startMs: 39_750,
      endMs: 66_000,
      speechMs: 18_000,
    });
    expect(languageWindow([], { windowMs: 30_000, durationMs: 10_000, padMs: 0 })).toBeNull();
  });

  it('never runs past the clip, and covers a short clip whole', () => {
    const window = languageWindow([{ startMs: 0, endMs: 4000 }], {
      windowMs: 30_000,
      durationMs: 5000,
      padMs: 250,
    });
    expect(window).toEqual({ startMs: 0, endMs: 4250, speechMs: 4000 });
  });
});

describe('voice scan', () => {
  it('stops once a window holds enough voice: a talking head is barely scanned', async () => {
    const pcm = await pcmOf('talking', 120, (ms) => ms % 5000 < 4000);
    const vad = loudnessVad();
    const scan = await scanSpeech(pcm, vad, { ...OPTIONS, regions: [{ startMs: 0, endMs: 120_000 }] });
    if (!scan.ok) throw new Error(scan.error.code);
    expect(scan.value.complete).toBe(false);
    expect(scan.value.window?.speechMs).toBeGreaterThanOrEqual(10_000);
    expect(vad.fed()).toBeLessThan(20_000);
  });

  it('scans all of a clip with no voice and finds none', async () => {
    const pcm = await pcmOf('quiet', 60, () => false);
    const vad = loudnessVad();
    const scan = await scanSpeech(pcm, vad, { ...OPTIONS, regions: [{ startMs: 0, endMs: 60_000 }] });
    expect(scan).toEqual(ok({ speechMs: 0, window: null, scannedMs: 60_000, complete: true, spans: [] }));
  });

  it('listens only inside the given stretches, and finds a short line in a long clip', async () => {
    const pcm = await pcmOf('sparse', 90, (ms) => ms >= 50_000 && ms < 56_000);
    const vad = loudnessVad();
    const regions = [{ startMs: 49_000, endMs: 57_000 }];
    const scan = await scanSpeech(pcm, vad, { ...OPTIONS, regions });
    if (!scan.ok) throw new Error(scan.error.code);
    expect(scan.value.complete).toBe(true);
    expect(vad.fed()).toBe(8000);
    expect(scan.value.speechMs).toBeGreaterThan(5800);
    expect(scan.value.window?.startMs).toBeGreaterThanOrEqual(49_000);
    expect(scan.value.window?.endMs).toBeLessThanOrEqual(57_000);
  });

  it('stops when cancelled', async () => {
    const pcm = await pcmOf('cancel', 10, () => true);
    const abort = new AbortController();
    abort.abort();
    const scan = await scanSpeech(pcm, loudnessVad(), {
      ...OPTIONS,
      regions: [{ startMs: 0, endMs: 10_000 }],
      signal: abort.signal,
    });
    expect(scan.ok ? 'ok' : scan.error.code).toBe('core.cancelled');
  });

  it('cuts the window out of the PCM byte for byte', async () => {
    const pcm = await pcmOf('cut', 4, (ms) => ms < 2000);
    const out = join(dir, 'window.wav');
    expect(await writePcmRange(pcm, { startMs: 1000, endMs: 3000 }, out)).toEqual(ok(out));
    const cut = await readSpeechPcm(out);
    expect(cut.ok && cut.value.frames).toBe(32_000);
  });
});
