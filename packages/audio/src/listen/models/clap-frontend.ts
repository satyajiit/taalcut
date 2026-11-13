// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CLAP's log-mel as a GPU graph (beats/mel-onnx.ts's shape): reflect-padded frames in, two MatMuls against a DFT
 * basis with the periodic Hann baked in, the power, the Slaney bank, a floor and 10·log10. `encodeOnnxModel` has no
 * attributes or initializers, so the basis, the bank and the constants are graph inputs, and the pad and framing
 * stay in TypeScript. The repeat pad, pad and frame count are written here again on purpose: sharing them with the
 * oracle would let one bug pass both sides of the equality test.
 */
import type { OnnxGraph } from '@taalcut/media';
import { LISTEN_CONFIG } from '../config';
import type { FrontEndConstant, FrontEndSpec } from './frontend-graph';
import { clapMelBank } from './mel-banks';

const { nFft, hop, nMels, maxSamples, frames, minSamples, powerFloor } = LISTEN_CONFIG.clap;
const BINS = nFft / 2 + 1;

/** One window's frames `[1001, 1024]`: `clap._prep`, `repeatpad`, then a centred reflect pad. All are real. */
export function clapFrames(segment: Float32Array, out: Float32Array, offset = 0): number {
  const used = Math.min(Math.max(segment.length, minSamples), maxSamples);
  const tiles = used < maxSamples ? Math.floor(maxSamples / used) : 1;
  const filled = tiles * used;
  const sample = (i: number): number => {
    if (i >= filled) return 0;
    const j = i % used;
    return j < segment.length ? (segment[j] ?? 0) : 0;
  };
  const pad = nFft / 2;
  const last = maxSamples - 1;
  for (let frame = 0; frame < frames; frame++) {
    const row = offset + frame * nFft;
    for (let n = 0; n < nFft; n++) {
      let i = frame * hop - pad + n;
      if (i < 0) i = -i;
      else if (i > last) i = 2 * last - i;
      out[row + n] = sample(i);
    }
  }
  return frames;
}

function graph(rows: number): OnnxGraph {
  return {
    name: 'clap_logmel',
    inputs: [
      { name: 'frames', dims: [rows, nFft] },
      { name: 'basisReal', dims: [nFft, BINS] },
      { name: 'basisImag', dims: [nFft, BINS] },
      { name: 'bank', dims: [BINS, nMels] },
      { name: 'floor', dims: [1] },
      { name: 'dbPerNeper', dims: [1] },
    ],
    outputs: [{ name: 'logMel', dims: [rows, nMels] }],
    nodes: [
      { op: 'MatMul', inputs: ['frames', 'basisReal'], outputs: ['re'] },
      { op: 'MatMul', inputs: ['frames', 'basisImag'], outputs: ['im'] },
      { op: 'Mul', inputs: ['re', 're'], outputs: ['re2'] },
      { op: 'Mul', inputs: ['im', 'im'], outputs: ['im2'] },
      { op: 'Add', inputs: ['re2', 'im2'], outputs: ['power'] },
      { op: 'MatMul', inputs: ['power', 'bank'], outputs: ['mel'] },
      { op: 'Max', inputs: ['mel', 'floor'], outputs: ['floored'] },
      { op: 'Log', inputs: ['floored'], outputs: ['nepers'] },
      { op: 'Mul', inputs: ['nepers', 'dbPerNeper'], outputs: ['logMel'] },
    ],
  };
}

function constants(): Record<string, FrontEndConstant> {
  const real = new Float32Array(nFft * BINS);
  const imag = new Float32Array(nFft * BINS);
  for (let n = 0; n < nFft; n++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nFft);
    for (let k = 0; k < BINS; k++) {
      const angle = (2 * Math.PI * ((k * n) % nFft)) / nFft;
      real[n * BINS + k] = window * Math.cos(angle);
      imag[n * BINS + k] = -window * Math.sin(angle);
    }
  }
  return {
    basisReal: { data: real, dims: [nFft, BINS] },
    basisImag: { data: imag, dims: [nFft, BINS] },
    bank: { data: Float32Array.from(clapMelBank()), dims: [BINS, nMels] },
    floor: { data: Float32Array.of(powerFloor), dims: [1] },
    dbPerNeper: { data: Float32Array.of(10 / Math.LN10), dims: [1] },
  };
}

export const CLAP_FRONT_END: FrontEndSpec = {
  key: 'clap',
  rowsPerWindow: frames,
  frameLength: nFft,
  width: nMels,
  graph,
  constants,
  frame: clapFrames,
  finish: () => undefined,
};
