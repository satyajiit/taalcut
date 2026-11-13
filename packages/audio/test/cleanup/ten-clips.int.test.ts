// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V9's Done when, on generated clips: the ten synthetic talking heads of `talking-head-scripts.ts`, labelled by
 * construction. At least 90 % of the labelled fillers and pauses are found, and no proposed cut clips a word: every
 * filler and pause the analysis reports, inset by the timeline's word guard (40 ms, timeline SPEC P3-V9), stays clear
 * of every kept phrase's voiced span (measured on the waveform, not taken from the transcript). The real criterion
 * stays the 10 labelled human clips (`tools/evals cleanup`, human input).
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, RationalTime, TimeRange } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpeechCleanupAnalyser } from '../../src/cleanup/analysis';
import { createSileroVad } from '../../src/cleanup/vad';
import { testMedia } from '../helpers/ffmpeg';
import { HAS_SAY } from '../helpers/speech';
import { buildTalkingHead, type BuiltClip } from '../helpers/talking-head';
import { SCRIPT_FILLERS, TEN_SCRIPTS } from './talking-head-scripts';

const MODEL = join(import.meta.dirname, '../../.cache/silero-vad/silero_vad.onnx');
const found = await testMedia('cleanup-ten');
/** Needs Silero VAD v6.2.3 (the silero-vad component in .cache), FFmpeg and macOS's `say`; skips and says why. */
const skip = !existsSync(MODEL)
  ? `ten talking heads: skipped, Silero VAD v6.2.3 is needed at ${MODEL} (the silero-vad component)`
  : !found.ctx
    ? found.skip
    : !HAS_SAY
      ? 'ten talking heads: skipped, the clips are spoken with macOS say'
      : '';
if (skip) console.warn(skip);
/** The timeline's word guard pads every kept word by this much before a cut (timeline SPEC P3-V9). */
const WORD_GUARD_MS = 40;
/** A labelled filler counts as found when a reported filler starts this close to it. */
const FOUND_WITHIN_MS = 150;
let media: MediaContext;
let root: string;
const clips: BuiltClip[] = [];

beforeAll(async () => {
  if (skip) return;
  media = found.ctx!;
  root = await mkdtemp(join(tmpdir(), 'taalcut-ten-clips-'));
  for (const [i, parts] of TEN_SCRIPTS.entries()) {
    const dir = join(root, `clip-${i}`);
    await mkdir(dir);
    clips.push(await buildTalkingHead(media, dir, parts));
  }
}, 300_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const msOf = (range: TimeRange) =>
  [RationalTime.toSeconds(range.start) * 1000, RationalTime.toSeconds(TimeRange.end(range)) * 1000] as const;
const overlaps = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[1] && b[0] < a[1];

describe.skipIf(Boolean(skip))('speech cleanup on ten generated talking heads (P3-V9 Done when)', () => {
  it('finds at least 90 % of the labelled fillers and pauses, and no cut clips a kept word', async () => {
    const analyser = createSpeechCleanupAnalyser({ vad: createSileroVad({ modelPath: MODEL }), media });
    let labelled = 0;
    let found = 0;
    const clipped: string[] = [];
    const missed: string[] = [];
    for (const [index, clip] of clips.entries()) {
      const analysis = await analyser.analyse({
        path: clip.path,
        assetId: newId<'Asset'>(),
        contentHash: index.toString(16).padStart(64, '0'),
        transcript: clip.transcript,
      });
      if (!analysis.ok) throw new Error(`clip ${index}: ${analysis.error.code}`);
      const fillers = analysis.value.fillers.map((f) => msOf(f.range));
      const pauses = analysis.value.pauses.map((p) => msOf(p.range));
      const last = clip.spans.length - 1;
      for (const [i, span] of clip.spans.entries()) {
        const part = span.part;
        if ('silenceMs' in part) {
          // Lead-in and tail silence aren't pauses between speech; gaps under the 200 ms floor aren't labelled.
          if (i === 0 || i === last || part.silenceMs < 250) continue;
          labelled += 1;
          if (pauses.some((p) => overlaps(p, [span.startMs, span.endMs]))) found += 1;
          else missed.push(`clip ${index}: ${part.silenceMs} ms pause at ${span.startMs.toFixed(0)} ms`);
        } else if (SCRIPT_FILLERS.has(part.say)) {
          labelled += 1;
          if (fillers.some(([start]) => Math.abs(start - span.startMs) < FOUND_WITHIN_MS)) found += 1;
          else missed.push(`clip ${index}: "${part.say}" at ${span.startMs.toFixed(0)} ms`);
        }
      }
      // What would be cut, inset by the word guard, never reaches a kept phrase's voiced audio.
      const cuts = [...fillers, ...pauses].map(
        ([start, end]) => [start + WORD_GUARD_MS, end - WORD_GUARD_MS] as const,
      );
      for (const span of clip.spans) {
        if ('silenceMs' in span.part || SCRIPT_FILLERS.has(span.part.say)) continue;
        for (const cut of cuts)
          if (cut[1] > cut[0] && overlaps(cut, [span.startMs, span.endMs]))
            clipped.push(
              `clip ${index}: "${span.part.say}" by [${cut[0].toFixed(0)}, ${cut[1].toFixed(0)}] ms`,
            );
      }
    }
    const recall = found / labelled;
    // The Done-when number, in the run's output for the lane report.
    console.warn(
      `[cleanup] ${found}/${labelled} labelled fillers and pauses found (${(recall * 100).toFixed(1)} %)`,
      ...(missed.length > 0 ? [`; missed: ${missed.join('; ')}`] : []),
    );
    expect(labelled).toBe(36);
    expect(recall, `${found} of ${labelled} found`).toBeGreaterThanOrEqual(0.9);
    expect(clipped).toEqual([]);
  }, 300_000);
});
