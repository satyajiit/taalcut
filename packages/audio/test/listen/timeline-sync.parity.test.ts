// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F6 against upstream earshot (tools/earshot-parity): the fixture films' cut sync. Upstream judged the cuts its
 * frame-difference detector found in each film's picture; Taalcut passes exact cut times, so the same list is passed
 * here (and checked against the planted ground truth). Done when the statuses are 100 % identical with offsets
 * within ±1 ms.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cutSyncReportSchema } from '@taalcut/core';
import { monoOf, stereoOf } from '../../src/listen/dsp/pcm';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { musicGrid } from '../../src/listen/dsp/tempo-grid';
import { analyseEvents } from '../../src/listen/timeline/events';
import { syncToCuts, toCutSyncReport } from '../../src/listen/timeline/sync';
import { cli, clips, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

interface UpstreamItem {
  readonly t: number;
  readonly status: string;
  readonly offset_ms: number | null;
  readonly accent_offset_ms: number | null;
  readonly beat_offset_ms?: number;
}

interface FilmTimeline {
  readonly duration: number;
  readonly cuts: number[];
  readonly fps: number;
  readonly sync: { cuts?: { items: UpstreamItem[]; stats: Record<string, unknown> } };
}

const STATUS: Record<string, string> = {
  OK: 'ok',
  near: 'near',
  swell: 'swell',
  peak: 'peak',
  off: 'off',
  'no sound': 'none',
};

const runner = createSpectrogramRunner();
const report: string[] = [];
afterAll(async () => {
  await runner.release();
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

describe('cut sync against upstream earshot', () => {
  it('gives the fixture films identical statuses with offsets within ±1 ms', async () => {
    const runs = cli<FilmTimeline>('timeline');
    let items = 0;
    let sameStatus = 0;
    let offsetsOk = 0;
    let accentOk = 0;
    for (const row of clips('film')) {
      const up = runs[row.id]?.result;
      if (!up?.sync.cuts) continue;
      const clip = loadClip(row.id);
      const audio = { sampleRate: clip.sampleRate, channels: clip.channels };
      const { events, levels } = await analyseEvents(audio, runner);
      const grid = await musicGrid(monoOf(stereoOf(audio)), runner);
      const beats = grid.confidence === 'clear' || grid.confidence === 'weak' ? grid.beats : undefined;
      const frameRate = { num: up.fps, den: 1 };
      const result = syncToCuts(up.cuts, events, {
        frameRate,
        levels,
        ...(beats ? { beats } : {}),
        durationS: up.duration,
      });
      const truth = (row.truth.cuts ?? []).map((t) => Math.round(t * 1000) / 1000);
      const detectedIsTruth =
        truth.length === up.cuts.length && truth.every((t, i) => Math.abs(t - (up.cuts[i] ?? -1)) <= 0.0005);
      report.push(
        `${row.id}: ${up.cuts.length} cuts (upstream's detected list ${detectedIsTruth ? 'equals' : 'differs from'} the planted truth)`,
      );
      expect(result.items).toHaveLength(up.sync.cuts.items.length);
      result.items.forEach((mine, i) => {
        const theirs = up.sync.cuts?.items[i] as UpstreamItem;
        items++;
        if (mine.status === STATUS[theirs.status]) sameStatus++;
        else
          report.push(
            `  ${row.id} cut ${theirs.t}: ${mine.status} ${mine.offsetMs} vs ${theirs.status} ${theirs.offset_ms}`,
          );
        const off =
          mine.offsetMs === null
            ? theirs.offset_ms === null
            : theirs.offset_ms !== null && Math.abs(mine.offsetMs - theirs.offset_ms) <= 1;
        if (off) offsetsOk++;
        const acc =
          mine.accentOffsetMs === null
            ? theirs.accent_offset_ms === null
            : theirs.accent_offset_ms !== null &&
              Math.abs(mine.accentOffsetMs - theirs.accent_offset_ms) <= 1;
        if (acc) accentOk++;
      });
      expect(cutSyncReportSchema.safeParse(toCutSyncReport(result, { frameRate })).success).toBe(true);
    }
    report.push(
      `statuses identical ${sameStatus}/${items}, offsets within ±1 ms ${offsetsOk}/${items}, accents ${accentOk}/${items}`,
    );
    expect(items).toBeGreaterThanOrEqual(30);
    expect(sameStatus).toBe(items);
    expect(offsetsOk).toBe(items);
  }, 120_000);
});
