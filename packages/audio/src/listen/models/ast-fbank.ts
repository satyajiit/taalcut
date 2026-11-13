// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AST's Kaldi fbank as a GPU graph. TypeScript cuts the frames and removes each one's DC (subtracting it on the GPU
 * would cancel large numbers in float32); the pre-emphasis and the symmetric Hann are folded into the DFT basis, and
 * the graph does the two MatMuls, the power, the Kaldi bank, the floor, ln and AST's normalisation. Rows past the
 * real frames are AST's zero padding, normalised, written after the run. The framing is written here again, apart
 * from the oracle's (ast-fbank.oracle.ts), on purpose.
 */
import type { OnnxGraph } from '@taalcut/media';
import { LISTEN_CONFIG } from '../config';
import type { FrontEndConstant, FrontEndSpec } from './frontend-graph';
import { astMelBank } from './mel-banks';

const { frameLength, frameShift, fftLength, nMels, maxFrames, mean, std, preemphasis, melFloor, minSamples } =
  LISTEN_CONFIG.ast;
const BINS = fftLength / 2 + 1;

/** One window's frames `[1024, 400]`, DC removed; returns how many rows are real frames. */
export function astFrames(segment16k: Float32Array, out: Float32Array, offset = 0): number {
  const length = Math.max(segment16k.length, minSamples);
  const count = Math.min(maxFrames, 1 + Math.floor((length - frameLength) / frameShift));
  out.fill(0, offset, offset + maxFrames * frameLength);
  for (let frame = 0; frame < count; frame++) {
    const row = offset + frame * frameLength;
    let sum = 0;
    for (let n = 0; n < frameLength; n++) {
      const i = frame * frameShift + n;
      const x = i < segment16k.length ? (segment16k[i] ?? 0) : 0;
      out[row + n] = x;
      sum += x;
    }
    const dc = sum / frameLength;
    for (let n = 0; n < frameLength; n++) out[row + n] = (out[row + n] ?? 0) - dc;
  }
  return count;
}

function graph(rows: number): OnnxGraph {
  return {
    name: 'ast_fbank',
    inputs: [
      { name: 'frames', dims: [rows, frameLength] },
      { name: 'basisReal', dims: [frameLength, BINS] },
      { name: 'basisImag', dims: [frameLength, BINS] },
      { name: 'bank', dims: [BINS, nMels] },
      { name: 'floor', dims: [1] },
      { name: 'mean', dims: [1] },
      { name: 'scale', dims: [1] },
    ],
    outputs: [{ name: 'fbank', dims: [rows, nMels] }],
    nodes: [
      { op: 'MatMul', inputs: ['frames', 'basisReal'], outputs: ['re'] },
      { op: 'MatMul', inputs: ['frames', 'basisImag'], outputs: ['im'] },
      { op: 'Mul', inputs: ['re', 're'], outputs: ['re2'] },
      { op: 'Mul', inputs: ['im', 'im'], outputs: ['im2'] },
      { op: 'Add', inputs: ['re2', 'im2'], outputs: ['power'] },
      { op: 'MatMul', inputs: ['power', 'bank'], outputs: ['mel'] },
      { op: 'Max', inputs: ['mel', 'floor'], outputs: ['floored'] },
      { op: 'Log', inputs: ['floored'], outputs: ['logMel'] },
      { op: 'Sub', inputs: ['logMel', 'mean'], outputs: ['centred'] },
      { op: 'Mul', inputs: ['centred', 'scale'], outputs: ['fbank'] },
    ],
  };
}

/**
 * Row j of the basis is frame sample j's contribution to each bin after the pre-emphasis (`e[0] = 0.03·x[0]`,
 * `e[n] = x[n] − 0.97·x[n−1]`) and the window: its own term plus −0.97 times the next sample's.
 */
function constants(): Record<string, FrontEndConstant> {
  const window = new Float64Array(frameLength);
  for (let n = 0; n < frameLength; n++)
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (frameLength - 1));
  const real = new Float32Array(frameLength * BINS);
  const imag = new Float32Array(frameLength * BINS);
  const angle = (k: number, n: number) => (2 * Math.PI * ((k * n) % fftLength)) / fftLength;
  for (let j = 0; j < frameLength; j++) {
    const own = (j === 0 ? 1 - preemphasis : 1) * (window[j] ?? 0);
    const next = j + 1 < frameLength ? -preemphasis * (window[j + 1] ?? 0) : 0;
    for (let k = 0; k < BINS; k++) {
      real[j * BINS + k] = own * Math.cos(angle(k, j)) + next * Math.cos(angle(k, j + 1));
      imag[j * BINS + k] = -(own * Math.sin(angle(k, j)) + next * Math.sin(angle(k, j + 1)));
    }
  }
  return {
    basisReal: { data: real, dims: [frameLength, BINS] },
    basisImag: { data: imag, dims: [frameLength, BINS] },
    bank: { data: Float32Array.from(astMelBank()), dims: [BINS, nMels] },
    floor: { data: Float32Array.of(melFloor), dims: [1] },
    mean: { data: Float32Array.of(mean), dims: [1] },
    scale: { data: Float32Array.of(1 / (2 * std)), dims: [1] },
  };
}

/** AST pads with zero rows after the log, then normalises them like the rest. */
function finish(window: Float32Array, valid: number): void {
  window.fill(-mean / (2 * std), valid * nMels);
}

export const AST_FRONT_END: FrontEndSpec = {
  key: 'ast',
  rowsPerWindow: maxFrames,
  frameLength,
  width: nMels,
  graph,
  constants,
  frame: astFrames,
  finish,
};
