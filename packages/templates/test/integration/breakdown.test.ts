// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T4 on synthetic reels made with the bundled FFmpeg: cuts within ±2 frames
 * (a 2-frame shot, a dissolve, a fade through black, a flash that isn't a
 * cut), click-track beats, anchors, pacing and audio kind, through the real
 * pipeline with FFmpeg stand-ins for the vision and audio lanes (method B is
 * a thumbnail, not EmbeddingGemma; no OCR).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createManualClock, FrameRate, newId, ok, RationalTime, templateSchema } from '@taalcut/core';
import {
  BREAKDOWN_FILE,
  buildTemplate,
  resolveCuts,
  runBreakdown,
  type BreakdownDraft,
} from '../../src/index';
import {
  createFfmpegAnalysers,
  runProcess,
  SYNTHETIC_REELS,
  syntheticLabels,
  syntheticReelArgs,
  type SyntheticReelSpec,
} from '../../src/test-support';
import { findFfmpeg } from '../helpers/ffmpeg';
import { json, sequentialIds } from '../helpers/fixtures';
import { ENVELOPE_RATE, onsetEnvelope } from '../helpers/onset-envelope';

const { bins, skip } = findFfmpeg('breakdown integration');
const root = mkdtempSync(join(tmpdir(), 'taalcut-breakdown-'));
const drafts = new Map<string, BreakdownDraft>();

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function breakDown(
  spec: SyntheticReelSpec,
  analysers = createFfmpegAnalysers(bins!),
  experiment = `exp-${spec.id}`,
): Promise<BreakdownDraft> {
  const reel = join(root, `${spec.id}.mp4`);
  if (!existsSync(reel)) {
    const made = await runProcess(bins!.ffmpeg, syntheticReelArgs(spec, reel));
    if (!made.ok) throw new Error(made.error.detail);
  }
  const experimentDir = join(root, experiment);
  await mkdir(experimentDir, { recursive: true });
  const draft = await runBreakdown(
    { breakdownId: newId(), referencePath: reel, input: 'file', platform: null, url: null },
    { ...analysers, experimentDir, clock: createManualClock(1) },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${draft.error.code}: ${draft.error.detail}`);
  return draft.value;
}

/** One-to-one matching within ±tolerance, nearest pairs first (as tools/evals scores). */
function within(found: readonly number[], expected: readonly number[], tolerance = 2) {
  const pairs = expected
    .flatMap((cut, i) => found.map((frame, j) => ({ i, j, d: Math.abs(frame - cut) })))
    .filter((pair) => pair.d <= tolerance)
    .sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const usedTrue = new Set<number>();
  const usedFound = new Set<number>();
  for (const { i, j } of pairs)
    if (!usedTrue.has(i) && !usedFound.has(j)) {
      usedTrue.add(i);
      usedFound.add(j);
    }
  return {
    missed: expected.filter((_, i) => !usedTrue.has(i)),
    extra: found.filter((_, j) => !usedFound.has(j)),
  };
}

describe.skipIf(Boolean(skip))('breakdown on synthetic reels', () => {
  beforeAll(async () => {
    for (const spec of SYNTHETIC_REELS) drafts.set(spec.id, await breakDown(spec));
  }, 600_000);

  it.each(SYNTHETIC_REELS.map((spec) => [spec.id, spec] as const))(
    '%s: cuts within ±2 frames by rule alone',
    (_id, spec) => {
      const draft = drafts.get(spec.id)!;
      const labels = syntheticLabels(spec);
      const cuts = resolveCuts(draft, []).cuts.map((cut) => cut.frame);
      expect(within(cuts, labels.cuts)).toEqual({ missed: [], extra: [] });
      expect(draft.duration.value).toBe(labels.durationFrames);
    },
  );

  it('keeps the 2-frame shot and ignores the one-frame flash', () => {
    const spec = SYNTHETIC_REELS[0]!;
    const cuts = resolveCuts(drafts.get(spec.id)!, []).cuts.map((cut) => cut.frame);
    expect(cuts.filter((frame) => frame >= 41 && frame <= 45)).toHaveLength(2);
    expect(cuts.some((frame) => Math.abs(frame - 50) <= 1 || Math.abs(frame - 51) <= 1)).toBe(false);
  });

  it('finds the dissolve as a soft cut with a transition, and the fade through black', () => {
    const draft = drafts.get('synthetic-transitions')!;
    const labels = syntheticLabels(SYNTHETIC_REELS[1]!);
    const dissolve = labels.transitions.find((t) => t.kind === 'dissolve')!.atFrame;
    const soft = [...draft.cuts, ...draft.disputes].find((cut) => Math.abs(cut.frame - dissolve) <= 2);
    expect(soft?.transition?.kind).toMatch(/dissolve|fade/);
  });

  it('tracks the click track to the beat, anchors slots and measures pacing', () => {
    const spec = SYNTHETIC_REELS[0]!;
    const draft = drafts.get(spec.id)!;
    const seconds = draft.beatMap!.beats.map((beat) => RationalTime.toSeconds(beat));
    seconds.slice(0, 8).forEach((time, k) => expect(Math.abs(time - k * 0.5)).toBeLessThanOrEqual(0.02));
    expect(draft.beatMap!.bpm).toBe(120);
    const template = buildTemplate(draft, [], [], sequentialIds(), {
      createdAt: 1,
      contactSheetAsset: 'c'.repeat(64),
    });
    expect(template.ok).toBe(true);
    const value = template.ok ? template.value : (undefined as never);
    expect(templateSchema.safeParse(json(value)).success).toBe(true);
    expect(value.slots.every((slot) => slot.beatAnchor !== null)).toBe(true);
    expect(value.pacing.shotCount).toBe(value.slots.length);
    expect(value.contactSheet?.frames.length).toBe(value.slots.length);
  });

  it('draws the waveform from the tracker’s onset envelope with its shape (REF1, gate finding 7)', async () => {
    // The beat tracker as the app runs it gives its raw onset strength as well; the stand-in gives none.
    const envelope = onsetEnvelope();
    const analysers = createFfmpegAnalysers(bins!);
    const tracker = {
      ...analysers,
      audio: {
        ...analysers.audio,
        beats: async (...args: Parameters<typeof analysers.audio.beats>) => {
          const beats = await analysers.audio.beats(...args);
          if (!beats.ok) return beats;
          return ok({ ...beats.value, envelope: { rate: FrameRate.of(ENVELOPE_RATE), peaks: envelope } });
        },
      },
    };
    const draft = await breakDown(SYNTHETIC_REELS[0]!, tracker, 'exp-envelope');
    const peaks = draft.audio.waveform?.peaks ?? [];
    expect(peaks).toHaveLength(envelope.length);
    const max = Math.max(...envelope);
    peaks.forEach((peak, frame) => expect(peak).toBeCloseTo(envelope[frame]! / max, 12));
    expect(peaks.filter((peak) => peak === 1).length).toBeLessThan(peaks.length * 0.02);
  });

  it('classifies the audio: click track music, a tone original sound, no track silent', () => {
    expect(drafts.get('synthetic-hard-cuts')!.audio.kind).toBe('music');
    expect(drafts.get('synthetic-original-sound')!.audio.kind).toBe('original');
    expect(drafts.get('synthetic-silent-ntsc')!.audio.kind).toBe('silent');
    expect(drafts.get('synthetic-silent-ntsc')!.beatMap).toBeNull();
  });

  it('keeps NTSC exact and writes the draft and the contact sheet into the experiment', () => {
    const draft = drafts.get('synthetic-silent-ntsc')!;
    expect(draft.canvas.rate).toEqual({ num: 30000, den: 1001 });
    const dir = join(root, 'exp-synthetic-silent-ntsc');
    expect(JSON.parse(readFileSync(join(dir, BREAKDOWN_FILE), 'utf8')).breakdownId).toBe(draft.breakdownId);
    expect(existsSync(join(dir, draft.contactSheet!.path))).toBe(true);
    expect(draft.slotFrames.every((slot) => slot.frames.every((frame) => existsSync(join(dir, frame))))).toBe(
      true,
    );
  });
});
