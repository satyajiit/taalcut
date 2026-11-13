// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** 20 ms. An absolute error of this size fails; 19 ms passes. */
const DRIFT_FAIL_SECONDS = 0.02;

const CLICK_SECONDS = 0.01;
const CLICK_HZ = 1000;
const CLICK_AMPLITUDE = 0.5;
/** Signed 16-bit full scale is 2^15. The onset is 0.2 of that. */
const FULL_SCALE = 32768;
const ONSET_THRESHOLD = 0.2 * FULL_SCALE;
/**
 * A 1 kHz burst crosses the threshold twice a cycle. Stay latched until the
 * signal has been under the threshold for 2 ms, which is longer than those
 * dips and shorter than one frame at the rates these goldens use.
 */
const REARM_SECONDS = 0.002;

export interface ClickPcmOptions {
  sampleRate: number;
  durationFrames: number;
  fps: number;
  beats: readonly number[];
  /** Click length; 10 ms unless set. */
  clickSeconds?: number;
}

export function clickPcm(opts: ClickPcmOptions): Buffer {
  const { sampleRate, durationFrames, fps, beats } = opts;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('sampleRate must be a positive integer');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps must be positive');
  const totalSamples = Math.round((durationFrames * sampleRate) / fps);
  const pcm = Buffer.alloc(totalSamples * 2);
  const clickSamples = Math.round((opts.clickSeconds ?? CLICK_SECONDS) * sampleRate);
  for (const beat of beats) {
    const start = Math.round((beat * sampleRate) / fps);
    for (let i = 0; i < clickSamples; i += 1) {
      const index = start + i;
      if (index < 0 || index >= totalSamples) continue;
      const value = Math.sin(2 * Math.PI * CLICK_HZ * (i / sampleRate)) * CLICK_AMPLITUDE;
      const sample = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
      pcm.writeInt16LE(sample, index * 2);
    }
  }
  return pcm;
}

export function clickOnsets(pcm: Buffer, sampleRate: number): number[] {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('sampleRate must be a positive integer');
  const samples = Math.floor(pcm.length / 2);
  const rearmAfter = Math.max(1, Math.round(REARM_SECONDS * sampleRate));
  const onsets: number[] = [];
  let armed = true;
  let under = 0;
  for (let index = 0; index < samples; index += 1) {
    const magnitude = Math.abs(pcm.readInt16LE(index * 2));
    if (magnitude >= ONSET_THRESHOLD) {
      if (armed) onsets.push(index / sampleRate);
      armed = false;
      under = 0;
    } else {
      under += 1;
      if (under >= rearmAfter) armed = true;
    }
  }
  return onsets;
}

/**
 * True when any click is missing, extra, or at least 20 ms from its nearest
 * expected beat. Pairs are taken greediest-first by absolute error.
 */
export function driftFails(measuredSeconds: readonly number[], expectedSeconds: readonly number[]): boolean {
  if (measuredSeconds.length !== expectedSeconds.length) return true;
  if (measuredSeconds.some((value) => !Number.isFinite(value))) return true;
  if (expectedSeconds.some((value) => !Number.isFinite(value))) return true;
  const pairs: { measured: number; expected: number; distance: number }[] = [];
  measuredSeconds.forEach((measured, measuredIndex) => {
    expectedSeconds.forEach((expected, expectedIndex) => {
      pairs.push({
        measured: measuredIndex,
        expected: expectedIndex,
        distance: Math.abs(measured - expected),
      });
    });
  });
  pairs.sort((a, b) => a.distance - b.distance);
  const usedMeasured = new Set<number>();
  const usedExpected = new Set<number>();
  for (const pair of pairs) {
    if (usedMeasured.has(pair.measured) || usedExpected.has(pair.expected)) continue;
    if (pair.distance >= DRIFT_FAIL_SECONDS) return true;
    usedMeasured.add(pair.measured);
    usedExpected.add(pair.expected);
    if (usedMeasured.size === expectedSeconds.length) return false;
  }
  return usedMeasured.size !== expectedSeconds.length;
}

export function beatSeconds(
  frameRate: { numerator: number; denominator: number },
  beats: readonly number[],
): number[] {
  return beats.map((beat) => (beat * frameRate.denominator) / frameRate.numerator);
}

export function wavBytes(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function readWavPcm(wav: Buffer): { sampleRate: number; pcm: Buffer } {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let pcm: Buffer | undefined;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new Error('WAV chunk extends past the file');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is short');
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    } else if (id === 'data') {
      pcm = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (sampleRate <= 0 || pcm === undefined) throw new Error('WAV is missing fmt or data');
  if (channels !== 1 || bits !== 16) throw new Error('Click track WAV must be s16le mono');
  return { sampleRate, pcm };
}
