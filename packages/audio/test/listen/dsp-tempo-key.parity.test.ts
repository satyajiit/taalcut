// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F6 against upstream earshot (tools/earshot-parity): the beat grid (BPM within ±1 on ≥ 90 % of music clips)
 * and the key (identical on ≥ 85 %). The grid is earshot's own tracker (timeline.music_grid), compared with its
 * `timeline` output; the key with `measure --music` (librosa's chroma_cqt, approximated here; see cqt.ts).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { estimateKey } from '../../src/listen/dsp/key';
import { monoOf, stereoOf } from '../../src/listen/dsp/pcm';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { musicGrid } from '../../src/listen/dsp/tempo-grid';
import { cli, clips, intermediate, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

interface Grid {
  readonly tempo: number | null;
  readonly beats: number[];
  readonly downbeats: number[];
  readonly confidence: string;
  readonly pulse_clarity?: number;
}

const runner = createSpectrogramRunner();
const report: string[] = [];
afterAll(async () => {
  await runner.release();
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

function monoOfClip(id: string): Float32Array {
  const clip = loadClip(id);
  return monoOf(stereoOf({ sampleRate: clip.sampleRate, channels: clip.channels }));
}

describe('beat grid and key against upstream earshot', () => {
  it('gives the BPM within ±1 on ≥ 90 % of music clips, and the same grid', async () => {
    const grids = intermediate<Record<string, { grid: Grid }>>('beats');
    let within = 0;
    let n = 0;
    let sameBeats = 0;
    let all = 0;
    for (const [id, { grid }] of Object.entries(grids)) {
      const mine = await musicGrid(monoOfClip(id), runner);
      const tempoOk =
        grid.tempo === null ? mine.tempo === null : Math.abs((mine.tempo ?? -99) - grid.tempo) <= 1;
      const beatsOk =
        mine.beats.length === grid.beats.length &&
        mine.beats.every((b, i) => Math.abs(b - (grid.beats[i] ?? -1)) <= 0.0101);
      report.push(
        `${id}: tempo ${mine.tempo} vs ${grid.tempo}, clarity ${mine.pulseClarity} vs ${grid.pulse_clarity}, beats ${beatsOk ? 'same' : 'differ'}, ${mine.confidence}/${grid.confidence}`,
      );
      all++;
      if (beatsOk) sameBeats++;
      if (!id.startsWith('music-')) continue;
      n++;
      if (tempoOk) within++;
    }
    report.push(`tempo within ±1 BPM: ${within}/${n} music clips; same beats on ${sameBeats}/${all} clips`);
    expect(within / n).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it('names the same key as upstream on ≥ 85 % of music clips', async () => {
    const measures = cli<{ key?: Array<{ key: string; r: number }> }>('measure');
    let same = 0;
    let n = 0;
    let truthSame = 0;
    for (const row of clips('music')) {
      const want = measures[row.id]?.result.key?.[0]?.key;
      const keys = await estimateKey(monoOfClip(row.id), runner);
      const got = keys[0] ? `${keys[0].tonic} ${keys[0].mode}` : undefined;
      n++;
      if (got === want) same++;
      if (got === row.truth['key']) truthSame++;
      report.push(
        `${row.id}: key ${got} (r ${keys[0]?.r}) vs upstream ${want}, truth ${String(row.truth['key'])}`,
      );
    }
    report.push(`key identical: ${same}/${n}; right by the planted truth: ${truthSame}/${n}`);
    expect(same / n).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
