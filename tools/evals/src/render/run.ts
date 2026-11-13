// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type MetricPoint } from '../envelope';
import { beatSeconds, driftFails } from './audio';
import { beatsMatch, checkHashes, cutFrames, cutsMatch, framesToHash, type HashCheck } from './check';
import { type HashSample } from './hash';
import { type RenderGolden } from './schema';
import { type RenderGoldenScore, type RenderReport } from './report';
import { type StripReading } from './strip';

export interface DecodedRender {
  golden: RenderGolden;
  frames: readonly StripReading[];
  /** Click onsets in seconds. Empty when the wav is missing. */
  onsets: readonly number[];
  actualHashes?: readonly HashSample[];
  approvedHashes?: readonly HashSample[];
  qaPassed?: boolean;
}

function share(passing: number, total: number): number {
  return passing / total;
}

function hashResult(
  golden: RenderGolden,
  actual: readonly HashSample[] | undefined,
  approved: readonly HashSample[] | undefined,
): HashCheck {
  const check = checkHashes(actual, approved);
  if (approved === undefined) return check;
  const have = new Set(approved.map((sample) => sample.outputFrame));
  const missing = framesToHash(golden).filter((frame) => !have.has(frame));
  if (missing.length === 0) return check;
  return {
    approved: true,
    pass: false,
    failures: [...check.failures, ...missing.map((outputFrame) => ({ outputFrame, distance: 64 }))],
  };
}

function scoreOne(input: DecodedRender): RenderGoldenScore {
  const { golden } = input;
  const cuts = cutsMatch(golden, input.frames);
  const grid = beatsMatch(cutFrames(golden), golden.beats);
  const drift = !driftFails(input.onsets, beatSeconds(golden.frameRate, golden.beats));
  const hashes = hashResult(golden, input.actualHashes, input.approvedHashes);
  const score: RenderGoldenScore = {
    id: golden.id,
    synthetic: golden.synthetic,
    cutTiming: cuts.pass,
    beatGrid: grid.pass,
    audioDrift: drift,
    hashes: { approved: hashes.approved, pass: hashes.pass },
  };
  if (input.qaPassed !== undefined) score.qaPassed = input.qaPassed;
  if (cuts.firstMismatch !== undefined) score.firstMismatch = cuts.firstMismatch;
  return score;
}

export function buildRenderReport(results: readonly DecodedRender[]): RenderReport {
  if (results.length === 0) throw new Error('No render goldens to score');
  const goldens = results.map(scoreOne).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = goldens.length;
  const cutPassing = goldens.filter((golden) => golden.cutTiming).length;
  const beatPassing = goldens.filter((golden) => golden.beatGrid).length;
  const driftPassing = goldens.filter((golden) => golden.audioDrift).length;
  const qaRan = goldens.filter((golden) => golden.qaPassed !== undefined);
  const qaPassing = qaRan.filter((golden) => golden.qaPassed === true).length;
  const qaFirstPass = qaRan.length === 0 ? 1 : qaPassing / qaRan.length;
  const qaNote =
    qaRan.length === 0
      ? 'QA was not run.'
      : `${qaPassing}/${qaRan.length} goldens passed QA on the first pass.`;
  const timingPassing = goldens.filter((golden) => golden.cutTiming && golden.beatGrid && golden.audioDrift).length;
  const synthetic = goldens.some((golden) => golden.synthetic);
  const gatePass = timingPassing === total;
  const detail = `${timingPassing}/${total} goldens pass cut timing, the beat grid, and audio drift. ${qaNote}`;
  const metrics: MetricPoint[] = [
    { name: 'cutTiming', value: share(cutPassing, total), better: 'higher' },
    { name: 'beatGrid', value: share(beatPassing, total), better: 'higher' },
    { name: 'audioDrift', value: share(driftPassing, total), better: 'higher' },
    { name: 'qaFirstPass', value: qaFirstPass, better: 'higher' },
  ];
  return {
    suite: 'render',
    synthetic,
    claimed: !synthetic,
    gate: { id: '5', pass: gatePass, detail },
    metrics,
    qaNote,
    goldens,
  };
}
