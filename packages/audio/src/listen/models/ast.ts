// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AST, the AudioSet tagger (EAR1-F4), as `earshot.models.ast` runs it: each 48 kHz source resampled to 16 kHz,
 * cut into 10.24 s windows (hop 5.12 s, the last flush with the end), each window zero-padded to 0.1 s, the Kaldi
 * fbank (GPU graph or f64 oracle), the model, a sigmoid per class (independent probabilities, not a softmax), and
 * the windows reduced by their maximum (or mean). The 527 label names come from the component's `config.json`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { shareWork, type SharedWork } from '../abort';
import { LISTEN_CONFIG } from '../config';
import { ListenFailed } from '../errors';
import { astFbankOracle } from './ast-fbank.oracle';
import { AST_FRONT_END } from './ast-fbank';
import { frameBatch, splitFeatures } from './frontend-graph';
import { floatOutput } from './ort';
import { resample48kTo16k } from './resample';
import type { ListenSessions } from './sessions';
import { astWindows } from './windows';

const { maxFrames, nMels, labels: LABELS } = LISTEN_CONFIG.ast;

export interface AstResult {
  /** Logits per window (before the sigmoid). */
  readonly logits: readonly Float32Array[];
  /** The windows' sigmoids reduced by `reduce`, 527 values. */
  readonly probs: Float32Array;
}

export interface AstTagger {
  /** id2label, in class order. */
  labels(signal?: AbortSignal): AsyncResult<readonly string[]>;
  /** `[1024, 128]` normalised fbank per 16 kHz window. */
  features(windows16k: readonly Float32Array[], signal?: AbortSignal): Promise<Float32Array[]>;
  /** `AST.probs(arrays, reduce)`: one result per 48 kHz source, every window of every source batched together. */
  probs(
    sources: readonly Float32Array[],
    options?: { readonly reduce?: 'max' | 'mean'; readonly signal?: AbortSignal },
  ): AsyncResult<AstResult[]>;
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** `AST.top(p, k, min_p)`: the k most probable labels, best first. */
export function topLabels(
  probs: ArrayLike<number>,
  labels: readonly string[],
  k: number,
  minP = 0,
): { label: string; p: number }[] {
  const order = Array.from({ length: probs.length }, (_, i) => i).sort(
    (a, b) => (probs[b] ?? 0) - (probs[a] ?? 0) || a - b,
  );
  return order
    .slice(0, k)
    .filter((i) => (probs[i] ?? 0) >= minP)
    .map((i) => ({ label: labels[i] ?? String(i), p: probs[i] ?? 0 }));
}

export function createAstTagger(
  sessions: ListenSessions,
  batch: number = LISTEN_CONFIG.sessions.batch,
): AstTagger {
  /** Read once; every caller waits on its own signal (abort.ts `shareWork`), a failed read is let go. */
  let names: SharedWork<readonly string[]> | undefined;

  async function readLabels(signal?: AbortSignal): AsyncResult<readonly string[]> {
    const model = await sessions.model('ast', signal);
    if (!model.ok) return model;
    try {
      const config = JSON.parse(await readFile(join(model.value.dir, 'config.json'), 'utf8')) as {
        id2label?: Record<string, string>;
      };
      const list = Array.from({ length: LABELS }, (_, i) => config.id2label?.[String(i)] ?? '');
      if (list.some((label) => !label))
        return err(ListenFailed(undefined, { detail: 'AST id2label is incomplete' }));
      return ok(list);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'AST config.json unreadable';
      return err(ListenFailed(undefined, { detail: detail.slice(0, 500) }));
    }
  }

  async function features(
    windows16k: readonly Float32Array[],
    signal?: AbortSignal,
  ): Promise<Float32Array[]> {
    const framed = frameBatch(AST_FRONT_END, windows16k);
    const gpu = await sessions.frontEnd(AST_FRONT_END, framed, signal);
    if (gpu) return splitFeatures(AST_FRONT_END, gpu, framed.valid);
    return windows16k.map((window) => astFbankOracle(window));
  }

  async function logitsOf(
    windows: readonly Float32Array[],
    signal?: AbortSignal,
  ): AsyncResult<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < windows.length; i += batch) {
      if (signal?.aborted) return err(CancelledError());
      const chunk = windows.slice(i, i + batch);
      const feats = await features(chunk, signal);
      const input = new Float32Array(chunk.length * maxFrames * nMels);
      feats.forEach((block, j) => input.set(block, j * maxFrames * nMels));
      const ran = await sessions.run(
        'ast',
        { input_values: { type: 'float32', data: input, dims: [chunk.length, maxFrames, nMels] } },
        signal,
      );
      if (!ran.ok) return ran;
      const logits = floatOutput(ran.value, 'logits');
      if (!logits || logits.length < chunk.length * LABELS) {
        return err(ListenFailed(undefined, { detail: 'AST logits missing' }));
      }
      for (let j = 0; j < chunk.length; j++) out.push(logits.slice(j * LABELS, (j + 1) * LABELS));
    }
    return ok(out);
  }

  return {
    labels(signal) {
      if (!names || names.abandoned) {
        const pending = shareWork((own) => readLabels(own));
        names = pending;
        void pending.result.then((read) => {
          if (!read.ok && names === pending) names = undefined;
        });
      }
      return names.join(signal);
    },
    features,
    async probs(sources, options) {
      const windows: Float32Array[] = [];
      const owner: number[] = [];
      sources.forEach((source, i) => {
        for (const window of astWindows(resample48kTo16k(source))) {
          windows.push(window);
          owner.push(i);
        }
      });
      const ran = await logitsOf(windows, options?.signal);
      if (!ran.ok) return ran;
      const mean = options?.reduce === 'mean';
      return ok(
        sources.map((_, i) => {
          const mine = ran.value.filter((__, j) => owner[j] === i);
          const probs = new Float32Array(LABELS);
          for (let c = 0; c < LABELS; c++) {
            let acc = mean ? 0 : Number.NEGATIVE_INFINITY;
            for (const row of mine) {
              const p = sigmoid(row[c] ?? 0);
              acc = mean ? acc + p : Math.max(acc, p);
            }
            probs[c] = mean ? acc / Math.max(1, mine.length) : acc;
          }
          return { logits: mine, probs };
        }),
      );
    },
  };
}
