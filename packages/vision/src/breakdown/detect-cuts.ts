// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cut detection for reference reels (P2-T4, vision half): two methods for
 * every cut, and disputes handed back instead of guessed.
 *
 * 1. scdet on every frame of the grid (256 px) proposes each local peak at or
 *    above `cuts.proposeScore` (high recall).
 * 2. A peak ≥ `cuts.confirmScore` that isn't flash-shaped confirms on its own
 *    (`scdet`). Otherwise frames 2 before and 1 after are embedded: ≥
 *    `cuts.confirmDistance` confirms (`both`), < `cuts.rejectDistance` drops
 *    it, in between it is **disputed**.
 * 3. Soft cuts (dissolves, fades, whips) come from the embedding scan (soft-cuts.ts).
 * The breakdown never calls a model: disputes go to the Analyst, which asks
 * `vision.confirmCuts`; with no model at all `settleWithoutModel` keeps the
 * disputes one method is fairly sure of as `unverified`.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG, type Tier } from '../config';
import type { VisionEmbedder } from '../embed/embedder';
import { probeSource } from '../media/frames';
import { sceneScores, type SceneSample } from '../media/scene';
import { locate, pairDistances, type Located } from '../shots/confirm';
import { softCuts } from './soft-cuts';
import { plainRate, plainTime, type BreakdownCut, type CutList } from './types';

export interface DetectCutsDeps {
  readonly media: MediaContext;
  /** Absent: no second method; weak peaks are dropped and soft cuts can't be seen. */
  readonly embedder?: VisionEmbedder;
}

export interface DetectCutsOptions {
  /** Grid frames [start, end) of the source. Default: all of it. */
  readonly range?: { readonly start: number; readonly end: number };
  /** 'high' proposes from a lower scdet score (busy reels with soft cuts scdet barely sees). */
  readonly sensitivity?: 'normal' | 'high';
  readonly tier: Tier;
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

/** The proposal score with sensitivity 'high': lower still, the second method sorts it out. */
const HIGH_SENSITIVITY_PROPOSE = 3;
/** Peaks closer than this (frames) are one proposal. */
const PEAK_RADIUS = 2;

const cfg = VISION_CONFIG.cuts;

export async function detectCuts(
  path: string,
  deps: DetectCutsDeps,
  options: DetectCutsOptions,
): AsyncResult<CutList> {
  const { signal } = options;
  const probed = await probeSource(deps.media, path, signal);
  if (!probed.ok) return probed;
  const source = probed.value;
  const scene = await sceneScores(deps.media, source, {
    every: 1,
    longSide: cfg.longSide,
    ...(options.range ? { window: options.range } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!scene.ok) return scene;
  options.progress?.(0.35);
  const inRange = (index: number) =>
    !options.range || (index >= options.range.start && index < options.range.end);
  const samples = scene.value.filter((s) => inRange(s.index));
  const frameCount = Math.max(source.frameCount ?? 0, (samples.at(-1)?.index ?? 0) + 1);
  const start = options.range?.start ?? 0;
  const end = Math.min(frameCount, options.range?.end ?? frameCount);

  const propose = options.sensitivity === 'high' ? HIGH_SENSITIVITY_PROPOSE : cfg.proposeScore;
  const located = proposals(samples, propose, start);
  const distances = await pairDistances(located, source, deps, signal);
  if (!distances.ok && distances.error.code === 'core.cancelled') return distances;
  options.progress?.(0.6);
  const hard: BreakdownCut[] = [];
  for (const [i, candidate] of located.entries()) {
    const cut = classifyHard(candidate, distances.ok ? distances.value[i] : undefined, source.rate);
    if (cut) hard.push(cut);
  }
  if (signal?.aborted) return err(CancelledError());

  const notes: string[] = [];
  let scanFps = 0;
  let soft: BreakdownCut[] = [];
  if (deps.embedder) {
    scanFps = options.tier === 'minimum' ? cfg.softScanFpsMinimum : cfg.softScanFps;
    if (options.tier === 'minimum') notes.push(`Soft cuts scanned at ${scanFps} frame/s (Minimum tier).`);
    const found = await softCuts(
      source,
      hard.map((c) => c.frame),
      deps.embedder,
      deps.media,
      {
        scanFps,
        start,
        end,
        ...(signal ? { signal } : {}),
      },
    );
    if (!found.ok) {
      if (found.error.code === 'core.cancelled') return found;
      notes.push('Soft cuts were not scanned: the embedding model failed.');
    } else soft = found.value;
  } else {
    notes.push('No embedding model on this Mac: weak cuts were dropped and soft cuts were not scanned.');
  }
  options.progress?.(1);
  const near = (frame: number) => hard.some((h) => Math.abs(h.frame - frame) <= PEAK_RADIUS * 2);
  const cuts = [...hard, ...soft.filter((s) => !near(s.frame))].sort((a, b) => a.frame - b.frame);
  return ok({ frameRate: plainRate(source.rate), frameCount, cuts, softScanFps: scanFps, notes });
}

/** Local scdet peaks at or above `threshold`, one per ±2 frames, each with its flash shape. */
export function proposals(samples: readonly SceneSample[], threshold: number, start = 0): Located[] {
  const byIndex = new Map(samples.map((s) => [s.index, s]));
  const out: Located[] = [];
  for (const sample of samples) {
    if (sample.index <= start || sample.score < threshold) continue;
    let isPeak = true;
    for (let k = -PEAK_RADIUS; k <= PEAK_RADIUS && isPeak; k++) {
      const other = k === 0 ? undefined : byIndex.get(sample.index + k);
      // Ties go to the earlier frame: the first frame of the new shot.
      if (other && (other.score > sample.score || (other.score === sample.score && k < 0))) isPeak = false;
    }
    if (!isPeak) continue;
    const shape = locate(samples.filter((s) => s.index >= sample.index && s.index <= sample.index + 2));
    out.push(shape ?? { frame: sample.index, score: sample.score, flashLike: false });
  }
  return out;
}

/** The decision for one scdet proposal, given the embedding distance around it when there is one. */
export function classifyHard(
  candidate: Located,
  distance: number | undefined,
  rate: { readonly num: number; readonly den: number },
): BreakdownCut | null {
  const base = {
    frame: candidate.frame,
    at: plainTime(candidate.frame, rate),
    kind: 'hard' as const,
    score: Math.min(100, candidate.score),
  };
  if (candidate.score >= cfg.confirmScore && !candidate.flashLike) {
    const confidence = Math.min(1, 0.7 + candidate.score / 250);
    return { ...base, method: 'scdet', status: 'confirmed', confidence, ...withDistance(distance) };
  }
  if (distance === undefined) {
    // No second method: only a peak scdet alone is fairly sure of is worth a dispute.
    if (candidate.flashLike || candidate.score < cfg.unverifiedKeepScore) return null;
    return { ...base, method: 'scdet', status: 'disputed', confidence: 0.3 };
  }
  if (distance < cfg.rejectDistance) return null;
  if (distance >= cfg.confirmDistance) {
    return {
      ...base,
      method: 'both',
      status: 'confirmed',
      confidence: Math.min(1, 0.6 + distance),
      distance,
    };
  }
  const between = (distance - cfg.rejectDistance) / (cfg.confirmDistance - cfg.rejectDistance);
  return { ...base, method: 'both', status: 'disputed', confidence: 0.25 + 0.25 * between, distance };
}

function withDistance(distance: number | undefined): { distance?: number } {
  return distance === undefined ? {} : { distance };
}

/**
 * With no vision model to break ties, a dispute that one method is fairly
 * sure of stays as `unverified`: a hard cut scored ≥ `cuts.unverifiedKeepScore`,
 * or a soft cut whose pixels showed the transition (blend, dip, whip). Other disputes go.
 */
export function settleWithoutModel(cuts: readonly BreakdownCut[]): BreakdownCut[] {
  return cuts.flatMap((cut): BreakdownCut[] => {
    if (cut.status !== 'disputed') return [cut];
    const sure =
      cut.kind === 'hard' ? (cut.score ?? 0) >= cfg.unverifiedKeepScore : cut.transition !== undefined;
    return sure ? [{ ...cut, status: 'unverified' }] : [];
  });
}

/** Applies the vision model's verdicts (frame → cut or not, and a transition) to the disputed cuts. */
export function applyVerdicts(
  cuts: readonly BreakdownCut[],
  verdicts: ReadonlyMap<number, { readonly cut: boolean; readonly transition?: BreakdownCut['transition'] }>,
): BreakdownCut[] {
  return cuts.flatMap((cut): BreakdownCut[] => {
    const verdict = cut.status === 'disputed' ? verdicts.get(cut.frame) : undefined;
    if (!verdict) return [cut];
    if (!verdict.cut) return [];
    return [
      {
        ...cut,
        status: 'confirmed',
        method: 'vision',
        confidence: Math.max(cut.confidence, 0.8),
        ...(verdict.transition ? { transition: verdict.transition } : {}),
      },
    ];
  });
}
