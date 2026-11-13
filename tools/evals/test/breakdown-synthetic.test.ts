// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's cut accuracy on synthetic reels (P2-T4): lavfi reels made
 * with the bundled FFmpeg, labelled by how they were made, broken down by
 * @taalcut/templates' real pipeline with its FFmpeg stand-ins for the vision
 * and audio lanes (method B is a thumbnail, not EmbeddingGemma; no OCR), the
 * disputed cuts left to the rule (no model), and scored by this package's
 * scorer: within 2 frames, one-to-one. The report says synthetic: true and is
 * never a gate number; the real 85% gate needs the human golden set (H3).
 *
 * Set TAALCUT_EVAL_OUT to keep report.md and report.json.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createManualClock, newId } from '@taalcut/core';
import { resolveCuts, runBreakdown } from '@taalcut/templates';
import {
  createFfmpegAnalysers,
  runProcess,
  SYNTHETIC_REELS,
  syntheticLabels,
  syntheticReelArgs,
  type SyntheticReelSpec,
} from '@taalcut/templates/test-support';
import { bundledFfmpeg } from '../src/ffmpeg-bin';
import { parseGoldenReel, parsePredictionReel, renderJson, renderMarkdown, scoreAll } from '../src/index';
import type { GoldenReel, PredictionReel } from '../src/schema';

/** TAALCUT_FFMPEG_DIR, else the bundled build in this platform's layout (bundledFfmpeg, LNX1-PKG). */
function findFfmpeg() {
  const dir = process.env.TAALCUT_FFMPEG_DIR;
  if (dir) {
    const bins = { ffmpeg: join(dir, 'ffmpeg'), ffprobe: join(dir, 'ffprobe') };
    if (existsSync(bins.ffmpeg) && existsSync(bins.ffprobe)) return bins;
  }
  return bundledFfmpeg();
}

const bins = findFfmpeg();
const work = mkdtempSync(join(tmpdir(), 'taalcut-evals-breakdown-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function goldenFromSpec(spec: SyntheticReelSpec): GoldenReel {
  const labels = syntheticLabels(spec);
  const bounds = [0, ...labels.cuts, labels.durationFrames];
  return parseGoldenReel({
    reelId: spec.id,
    synthetic: true,
    note: 'Synthetic lavfi reel generated at test time; labels come from how it was made. Not a real reel.',
    source: { label: spec.id, durationFrames: labels.durationFrames, width: spec.width, height: spec.height },
    frameRate: { numerator: spec.rate.num, denominator: spec.rate.den },
    cuts: [...labels.cuts],
    beats: labels.beats
      .filter((frame) => frame < labels.durationFrames)
      .map((frame) => ({ frame, kind: 'beat' })),
    slots: bounds.slice(0, -1).map((start, index) => ({
      id: `slot-${index}`,
      startFrame: start,
      endFrame: bounds[index + 1],
      intent: 'synthetic shot',
    })),
    overlays: labels.overlays.map((box, index) => ({
      id: `box-${index}`,
      text: '',
      startFrame: box.start,
      endFrame: box.end,
      position: { x: box.x, y: box.y, width: box.width, height: box.height },
    })),
    transitions: labels.transitions.map(({ atFrame, kind }) => ({ atFrame, kind })),
    audio: { type: labels.audio === 'ambience' ? 'ambience' : labels.audio },
    languages: ['en'],
  });
}

async function predict(spec: SyntheticReelSpec): Promise<PredictionReel> {
  const reel = join(work, `${spec.id}.mp4`);
  const made = await runProcess(bins!.ffmpeg, syntheticReelArgs(spec, reel));
  if (!made.ok) throw new Error(made.error.detail);
  const experimentDir = join(work, `exp-${spec.id}`);
  mkdirSync(experimentDir, { recursive: true });
  const draft = await runBreakdown(
    { breakdownId: newId(), referencePath: reel, input: 'file', platform: null, url: null },
    { ...createFfmpegAnalysers(bins!), experimentDir, clock: createManualClock(0) },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${spec.id}: ${draft.error.code} ${draft.error.detail ?? ''}`);
  // No model offline: every disputed cut is left to the rule, as when vision is unavailable.
  const { cuts } = resolveCuts(draft.value, []);
  return parsePredictionReel({ reelId: spec.id, cuts: cuts.map((cut) => cut.frame) });
}

describe.skipIf(!bins)('breakdown cut accuracy on synthetic reels', () => {
  it('scores every synthetic reel within 2 frames and writes a synthetic report', async () => {
    const pairs = [];
    for (const spec of SYNTHETIC_REELS)
      pairs.push({ reel: goldenFromSpec(spec), prediction: await predict(spec) });
    const report = scoreAll(pairs);
    const out = process.env.TAALCUT_EVAL_OUT ?? join(work, 'report');
    mkdirSync(out, { recursive: true });
    const markdown = `<!-- synthetic: true (lavfi reels, FFmpeg stand-ins for vision and audio, rule-only disputes) -->\n${renderMarkdown(report)}`;
    writeFileSync(join(out, 'report.md'), markdown);
    writeFileSync(join(out, 'report.json'), renderJson(report));

    expect(report.reels.every((reel) => reel.synthetic)).toBe(true);
    expect(report.aggregate.reelCount).toBe(SYNTHETIC_REELS.length);
    // The synthetic reels are easy on purpose; anything below the bar here is a regression.
    expect(report.aggregate.reelsMeetingBarShare).toBe(1);
    expect(report.aggregate.f1).toBeGreaterThanOrEqual(0.95);
    // Four reels made and broken down with FFmpeg: seconds alone, longer beside the other suites.
  }, 180_000);
});

if (!bins)
  it.skip('breakdown synthetic eval: skipped, no FFmpeg. Set TAALCUT_FFMPEG_DIR or build tools/ffmpeg.', () =>
    undefined);
