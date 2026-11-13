// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F6 against upstream earshot (tools/earshot-parity): every `earshot timeline` run's events, and the onset
 * intermediates. Done when ≥ 98 % of upstream's onsets are found within ±5 ms with ≤ 2 % extra.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { analyseEvents, type ListenEvent } from '../../src/listen/timeline/events';
import { cli, intermediate, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

interface UpstreamEvent {
  readonly t: number;
  readonly shape: 'hit' | 'swell';
  readonly band: string;
  readonly prominence_db: number;
  readonly bed_db: number;
  readonly contrast_db: number;
  readonly length_ms: number;
}

interface TimelineResult {
  readonly events: UpstreamEvent[];
  readonly duration: number;
}

const runner = createSpectrogramRunner();
afterAll(() => runner.release());

const report: string[] = [];
const say = (line: string) => report.push(line);
afterAll(() => {
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

/** Each upstream event matched to the nearest unused one of ours within `tolS`. */
function matchEvents(ours: readonly ListenEvent[], theirs: readonly UpstreamEvent[], tolS: number) {
  const used = new Set<number>();
  let found = 0;
  const pairs: Array<[ListenEvent, UpstreamEvent]> = [];
  for (const u of theirs) {
    let best = -1;
    for (let i = 0; i < ours.length; i++) {
      const o = ours[i] as ListenEvent;
      if (used.has(i) || o.shape !== u.shape) continue;
      const d = Math.abs(o.t - u.t);
      if (d <= tolS + 1e-9 && (best < 0 || d < Math.abs((ours[best] as ListenEvent).t - u.t))) best = i;
    }
    if (best >= 0) {
      used.add(best);
      found++;
      pairs.push([ours[best] as ListenEvent, u]);
    }
  }
  return { found, extra: ours.length - used.size, pairs };
}

describe('events against upstream earshot', () => {
  it('finds ≥ 98 % of upstream onsets within ±5 ms with ≤ 2 % extra, over every timeline run', async () => {
    let total = 0;
    let found = 0;
    let extra = 0;
    let ours = 0;
    let promWithin = 0;
    for (const [id, run] of Object.entries(cli<TimelineResult>('timeline'))) {
      const clip = loadClip(id);
      const { events } = await analyseEvents(
        { sampleRate: clip.sampleRate, channels: clip.channels },
        runner,
      );
      const mine = events.filter((e) => e.t < run.result.duration);
      const m = matchEvents(mine, run.result.events, 0.005);
      total += run.result.events.length;
      found += m.found;
      extra += m.extra;
      ours += mine.length;
      promWithin += m.pairs.filter(([o, u]) => Math.abs(o.prominenceDb - u.prominence_db) <= 0.2).length;
      say(
        `${id}: upstream ${run.result.events.length}, ours ${mine.length}, matched ${m.found}, extra ${m.extra}`,
      );
    }
    say(
      `events: ${found}/${total} matched (${((100 * found) / total).toFixed(2)} %), extra ${extra}/${ours}`,
    );
    say(`prominence within 0.2 dB: ${promWithin}/${found}`);
    expect(found / total).toBeGreaterThanOrEqual(0.98);
    expect(extra / ours).toBeLessThanOrEqual(0.02);
  }, 120_000);

  it('picks the same onset frames as upstream on the intermediate clips', async () => {
    const onsets = intermediate<Record<string, { picked: number[]; frames: number }>>('onsets');
    for (const [id, want] of Object.entries(onsets)) {
      const clip = loadClip(id);
      const { onset } = await analyseEvents({ sampleRate: clip.sampleRate, channels: clip.channels }, runner);
      expect(onset.odf.length, id).toBe(want.frames);
      const same = onset.picked.filter((p) => want.picked.includes(p)).length;
      say(`${id}: picked ${onset.picked.length} vs ${want.picked.length}, same ${same}`);
      expect(same / Math.max(1, want.picked.length), id).toBeGreaterThanOrEqual(0.98);
    }
  }, 60_000);
});
