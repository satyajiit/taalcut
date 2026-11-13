// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The waveform from the audio pass's PCM (IX-D4): peaks streamed from a
 * 16 kHz WAV equal the in-memory peaks of the same samples across chunk
 * edges, and makeWaveform writes the port's peaks instead of decoding, or
 * decodes when the port has none. No FFmpeg.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { err } from '@taalcut/core';
import { MediaCancelled, peaksFromSpeechPcm, type SpeechPcmPort } from '@taalcut/media';
import { encodeWaveformPeaks } from '../../src/previews/peaks';
import { makeWaveform } from '../../src/previews/waveform';
import { videoPlan } from '../helpers/video-plan';

const HEADER = 44;

describe('peaks from the speech PCM', () => {
  let dir: string;
  let wav: string;
  // 50 s: past one 4,096-bucket chunk (about 41 s), and a ragged last bucket.
  const samples = Int16Array.from({ length: 50 * 16_000 + 37 }, (_, i) =>
    Math.round(20_000 * Math.sin(i / 7) * Math.sin(i / 16_000)),
  );

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-pcm-'));
    wav = join(dir, 'speech.wav');
    await writeFile(wav, Buffer.concat([Buffer.alloc(HEADER), Buffer.from(samples.buffer)]));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const pcm = () => ({ path: wav, dataOffset: HEADER, frames: samples.length });

  it('streams the same min and max per 10 ms as the in-memory peaks', async () => {
    const streamed = await peaksFromSpeechPcm(pcm());
    expect(streamed.ok && streamed.value.equals(encodeWaveformPeaks(samples, 16_000, 100))).toBe(true);
  });

  it("makeWaveform writes the port's peaks and decodes nothing", async () => {
    const asked: unknown[] = [];
    const port: SpeechPcmPort = {
      peaks: async (asset) => {
        asked.push(asset.path);
        return peaksFromSpeechPcm(pcm());
      },
    };
    const out = join(dir, 'wave.bin');
    const plan = videoPlan({}, true);
    // No binaries: a decode would fail.
    const made = await makeWaveform('/proxy.mp4', plan, { binaries: {} as never }, out, {
      pcm: { port, asset: { path: '/missing.mov', plan } },
    });
    expect(made.ok && made.value).toMatchObject({ bucketsPerSec: 100, count: 5001 });
    expect((await readFile(out)).readUInt32LE(8)).toBe(5001);
    // The asset's own file, not the proxy the filmstrip reads.
    expect(asked).toEqual(['/missing.mov']);
  });

  it('decodes the audio itself when the port has no peaks', async () => {
    const port: SpeechPcmPort = { peaks: async () => err(MediaCancelled()) };
    const plan = videoPlan({}, true);
    const made = await makeWaveform('/missing.mov', plan, { binaries: {} as never }, undefined, {
      pcm: { port, asset: { path: '/missing.mov', plan } },
    });
    // The fallback decode ran (and failed here: no binaries, no file).
    expect(made.ok).toBe(false);
  });
});
