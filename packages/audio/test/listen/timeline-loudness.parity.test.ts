// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline's loudness picture against upstream earshot (tools/earshot-parity `timeline` runs): integrated, true
 * peak, LRA, the loudest moments, every momentary and short-term value (0.1 LU), gaps and clipping; and the DSP's
 * runtime on a 60 s mix (EAR1 plan: well under 1 s on the reference Mac), printed with TAALCUT_LISTEN_REPORT=1.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { measureSound } from '../../src/listen/dsp/measure';
import { timelineLoudness } from '../../src/listen/dsp/loudness-timeline';
import { monoOf, stereoOf } from '../../src/listen/dsp/pcm';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { musicGrid } from '../../src/listen/dsp/tempo-grid';
import { analyseEvents } from '../../src/listen/timeline/events';
import { syncToCuts } from '../../src/listen/timeline/sync';
import { cli, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

interface UpLoudness {
  readonly integrated_lufs: number | null;
  readonly true_peak_dbtp: number | null;
  readonly lra_lu: number | null;
  readonly momentary?: { lufs: number[] };
  readonly short_term?: { lufs: number[] };
  readonly silences: Array<{ start: number; end: number; kind: string; where?: string }>;
  readonly clipping: { samples: number; runs: number };
}

const runner = createSpectrogramRunner();
const report: string[] = [];
afterAll(async () => {
  await runner.release();
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

const near = (a: number | null | undefined, b: number | null | undefined, tol: number) =>
  a === null || a === undefined
    ? b === null || b === undefined
    : b !== null && b !== undefined && Math.abs(a - b) <= tol + 1e-9;

describe('timeline loudness against upstream earshot', () => {
  it('matches every run’s loudness picture', async () => {
    let checks = 0;
    let ok = 0;
    const check = (id: string, what: string, pass: boolean) => {
      checks++;
      if (pass) ok++;
      else report.push(`${id} ${what}`);
    };
    for (const [id, run] of Object.entries(cli<{ loudness: UpLoudness }>('timeline'))) {
      const clip = loadClip(id);
      const mine = timelineLoudness(stereoOf({ sampleRate: clip.sampleRate, channels: clip.channels }));
      const up = run.result.loudness;
      check(
        id,
        `integrated ${mine.integratedLufs} vs ${up.integrated_lufs}`,
        near(mine.integratedLufs, up.integrated_lufs, 0.1),
      );
      check(
        id,
        `true peak ${mine.truePeakDbtp} vs ${up.true_peak_dbtp}`,
        near(mine.truePeakDbtp, up.true_peak_dbtp, 0.1),
      );
      check(id, `lra ${mine.lraLu} vs ${up.lra_lu}`, near(mine.lraLu, up.lra_lu, 0.1));
      for (const [name, a, b] of [
        ['momentary', mine.momentary?.lufs, up.momentary?.lufs],
        ['short-term', mine.shortTerm?.lufs, up.short_term?.lufs],
      ] as const) {
        check(id, `${name} length`, (a?.length ?? 0) === (b?.length ?? 0));
        check(
          id,
          `${name} values`,
          (a ?? []).every((v, i) => near(v, b?.[i], 0.1)),
        );
      }
      const gaps = (g: ReadonlyArray<{ start: number; end: number; kind: string; where?: string }>) =>
        g.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)} ${s.kind} ${s.where ?? ''}`).join('; ');
      check(
        id,
        `silences ${gaps(mine.silences)} vs ${gaps(up.silences)}`,
        gaps(mine.silences) === gaps(up.silences),
      );
      check(
        id,
        'clipping',
        mine.clipping.samples === up.clipping.samples && mine.clipping.runs === up.clipping.runs,
      );
    }
    report.push(`timeline loudness checks: ${ok}/${checks}`);
    expect(ok).toBe(checks);
  }, 120_000);

  it('runs the DSP on a 60 s mix in well under a few seconds', async () => {
    const parts = ['film-01', 'film-05', 'music-120-fmaj'].map(
      (id) => loadClip(id).channels[0] as Float32Array,
    );
    const samples = new Float32Array(60 * 48_000);
    for (let at = 0, k = 0; at < samples.length; k++) {
      const part = parts[k % parts.length] as Float32Array;
      samples.set(part.subarray(0, Math.min(part.length, samples.length - at)), at);
      at += part.length;
    }
    const audio = { sampleRate: 48_000, channels: [samples] };
    const cuts = Array.from({ length: 30 }, (_, i) => 1 + i * 1.9);
    // Warm: the sessions stay open for the runner's life (F7 keeps one), so a second analysis is the steady state.
    for (const warm of [false, true]) {
      const started = performance.now();
      const lap: string[] = [];
      let t = started;
      const mark = (name: string) => {
        const now = performance.now();
        lap.push(`${name} ${(now - t).toFixed(0)} ms`);
        t = now;
      };
      const { events, levels, kPower } = await analyseEvents(audio, runner);
      mark('events');
      const loud = timelineLoudness(stereoOf(audio), { kPower });
      mark('loudness');
      const grid = await musicGrid(monoOf(stereoOf(audio)), runner);
      mark('beat grid');
      syncToCuts(cuts, events, { levels, beats: grid.beats, durationS: 60 });
      mark('sync');
      const measured = await measureSound(audio, runner, { music: true, kPower, grid });
      mark('measure + key');
      const total = performance.now() - started;
      report.push(
        `60 s mix on ${runner.backend()}, ${warm ? 'warm' : 'cold'}: ${total.toFixed(0)} ms (${lap.join(', ')})`,
      );
      expect(loud.integratedLufs).not.toBeNull();
      expect(measured.key?.length).toBe(3);
      expect(total).toBeLessThan(15_000);
    }
  }, 120_000);
});
