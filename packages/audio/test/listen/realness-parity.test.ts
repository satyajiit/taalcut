// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1 realness against upstream earshot (tools/earshot-parity, fp32), without models: the CLAP head from the
 * stored embeddings (every clip but the films and 9 music clips, whose stored per-window CLAP logits stand in), the
 * signal measurements and the pure-tone rule from the clips themselves, then the windows, the mean and the
 * verdicts. Done when (plan): p_real within ±0.02 on 40 clips or more, identical verdicts.
 */
import { soundRealnessSchema } from '@taalcut/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  blob,
  blobRows,
  cliRun,
  ffmpegMono,
  intermediate,
  loadClip,
  manifest,
} from '../../../../tools/earshot-parity/fixtures.mjs';
import {
  audible,
  liftQuiet,
  signalFeatures,
  SIGNAL_FEATURES,
  type SignalFeatures,
} from '../../src/listen/realness/features';
import { headLogit, realnessModel } from '../../src/listen/realness/model';
import {
  realnessFromScores,
  realnessOf,
  realnessSpans,
  scoreWindow,
  toSoundRealness,
  type RealnessSpan,
} from '../../src/listen/realness/realness';
import { upstreamWindows, type UpstreamRealness, type UpstreamRealnessClip } from './realness-helpers';

const inter = intermediate<{ clips: Record<string, UpstreamRealnessClip> }>('realness');
const clipIds = manifest().clips.map((c) => c.id);

interface Analysed {
  readonly spans: RealnessSpan[];
  readonly features: (SignalFeatures | null)[];
  readonly gainDb: number;
  readonly duration: number;
}
const analysed = new Map<string, Analysed>();

beforeAll(() => {
  for (const id of clipIds) {
    const lifted = liftQuiet(ffmpegMono(loadClip(id)));
    const spans = realnessSpans(lifted.x);
    analysed.set(id, {
      spans,
      features: spans.map((s) => (audible(s.samples) ? signalFeatures(s.samples) : null)),
      gainDb: lifted.gainDb,
      duration: lifted.x.length / 48_000,
    });
  }
}, 120_000);

/** Each feature's tolerance: tight where upstream's numbers don't hang on soxr's float32 noise floor. */
const FEATURE_TOL: Record<(typeof SIGNAL_FEATURES)[number], number> = {
  silence_frac: 1e-9,
  floor_db: 1e-4,
  // These read spectral floors 120–170 dB down, where soxr's float32 arithmetic leaves noise the float64 port doesn't.
  spec_floor_db: 6,
  log_flatness: 0.6,
  peakiness_db: 6,
  quiet_flat: 0.6,
  line_share: 1e-6,
  bandwidth_khz: 1e-9,
  tonal_frames: 1e-9,
  pitch_wobble: 1e-3,
  env_resid_db: 1e-3,
  texture_kurt: 0.05,
  crest_db: 0.5,
};

describe('realness against upstream (stored embeddings and logits)', () => {
  it('cuts the same windows, lifts by the same gain and finds the same live windows', () => {
    for (const id of clipIds) {
      const up = inter.clips[id] as UpstreamRealnessClip;
      const a = analysed.get(id) as Analysed;
      expect(a.gainDb, id).toBeCloseTo(up.gain_db, 6);
      expect(
        a.spans.map((s) => [s.start, s.end]),
        id,
      ).toEqual(up.windows.map((w) => [expect.closeTo(w.start, 5), expect.closeTo(w.end, 5)]));
      expect(
        a.features.map((f) => f !== null),
        id,
      ).toEqual(up.windows.map((w) => w.live));
    }
  });

  it('measures the signal features, the pure-tone rule and the facts as upstream does', () => {
    const m = realnessModel();
    let windows = 0;
    for (const id of clipIds) {
      const up = inter.clips[id] as UpstreamRealnessClip;
      (analysed.get(id) as Analysed).features.forEach((f, i) => {
        const w = up.windows[i];
        if (!f || !w?.features) return;
        windows += 1;
        for (const k of SIGNAL_FEATURES) {
          const a = f[k];
          const b = w.features[k] ?? Number.NaN;
          if (!Number.isFinite(b)) expect(Number.isFinite(a), `${id}#${i} ${k}`).toBe(false);
          else expect(Math.abs(a - b), `${id}#${i} ${k}: ${a} vs ${b}`).toBeLessThanOrEqual(FEATURE_TOL[k]);
        }
        const s = scoreWindow(f, { logit: w.logits?.clap ?? 0 }, m);
        expect(s.tone, `${id}#${i} tone`).toBe(w.tone);
        for (const q of m.facts) {
          const fires = (v: number) => Number.isFinite(v) && (q.op === '<=' ? v <= q.value : v >= q.value);
          expect(fires(f[q.feature as keyof SignalFeatures]), `${id}#${i} fact ${q.feature}`).toBe(
            fires(w.features[q.feature] ?? Number.NaN),
          );
        }
        // The signal head, exactly, on upstream's own measurements (its fusion weight is 0).
        const ls = headLogit(
          m.heads.signal,
          SIGNAL_FEATURES.map((k) => w.features?.[k] ?? Number.NaN),
        );
        expect(ls).toBeCloseTo(w.logits?.signal ?? 0, 9);
      });
    }
    expect(windows).toBe(214);
  });

  it('reads upstream CLAP head logits from the stored embeddings', () => {
    const m = realnessModel();
    let checked = 0;
    for (const id of clipIds) {
      const up = inter.clips[id] as UpstreamRealnessClip;
      if (!up.embeddings) continue;
      const rows = blobRows(up.embeddings);
      const live = (blob(up.embeddings).info['windows'] as number[] | undefined) ?? [0];
      live.forEach((wi, j) => {
        expect(headLogit(m.heads.clap, rows[j] as Float32Array), `${id}#${wi}`).toBeCloseTo(
          up.windows[wi]?.clapLogitCheck ?? 0,
          4,
        );
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThanOrEqual(60);
  });

  it('p_real within ±0.02 of upstream with identical verdicts, windows and counts on every clip', () => {
    const m = realnessModel();
    let compared = 0;
    let worst = 0;
    for (const id of clipIds) {
      const up = inter.clips[id] as UpstreamRealnessClip;
      const cli = cliRun<UpstreamRealness>('realness', id);
      const a = analysed.get(id) as Analysed;
      const logits = upstreamWindows(up);
      const scores = a.features.map((f, i) => {
        const clap = logits[i];
        return f && clap !== undefined ? scoreWindow(f, clap, m) : null;
      });
      const r = realnessFromScores(a.duration, a.spans, scores, { gainDb: a.gainDb });
      expect(r.verdict, id).toBe(cli.verdict);
      expect(soundRealnessSchema.safeParse(toSoundRealness(r)).success, id).toBe(true);
      if (cli.p_real === null) {
        expect(r.pReal, id).toBeNull();
        continue;
      }
      compared += 1;
      worst = Math.max(worst, Math.abs((r.pReal ?? 0) - cli.p_real));
      expect(Math.abs((r.pReal ?? 0) - cli.p_real), id).toBeLessThanOrEqual(0.02);
      if (cli.segments) {
        expect(
          r.segments?.map((s) => [s.start, s.end, s.verdict]),
          id,
        ).toEqual(cli.segments.map((s) => [s.start, s.end, s.verdict]));
        r.segments?.forEach((s, i) =>
          expect(Math.abs((s.pReal ?? 0) - (cli.segments?.[i]?.p_real ?? 0))).toBeLessThanOrEqual(0.02),
        );
        expect(r.synthWindows, id).toBe(cli.synth_windows);
        expect(r.leanSynthWindows, id).toBe(cli.lean_synth_windows);
        expect(Math.abs((r.pRealMin ?? 0) - (cli.p_real_min ?? 0)), id).toBeLessThanOrEqual(0.02);
      } else {
        expect(r.segments, id).toBeUndefined();
      }
    }
    expect(compared).toBeGreaterThanOrEqual(40);
    expect(worst).toBeLessThanOrEqual(0.002);
  });

  it('runs realnessOf through an embedder (the stored embeddings) and reads the closest prompt', async () => {
    const prompts = blobRows('realness/prompts');
    for (const id of clipIds) {
      const up = inter.clips[id] as UpstreamRealnessClip;
      if (!up.embeddings) continue;
      const rows = blobRows(up.embeddings);
      const embedder = {
        embedSegments: async (segments: readonly Float32Array[]) => {
          expect(segments.length, id).toBe(rows.length);
          return { ok: true as const, value: rows };
        },
      };
      const r = await realnessOf(ffmpegMono(loadClip(id)), embedder, { prompts });
      if (!r.ok) throw new Error(id);
      const cli = cliRun<UpstreamRealness>('realness', id);
      expect(r.value.verdict, id).toBe(cli.verdict);
      expect(Math.abs((r.value.pReal ?? 0) - (cli.p_real ?? 0)), id).toBeLessThanOrEqual(0.02);
      const closest = cli.evidence
        ?.find((e) => e.startsWith('CLAP head'))
        ?.match(/closest reference prompt '([^']+)'/)?.[1];
      if (closest && !r.value.long) expect(r.value.closest?.prompt, id).toBe(closest);
    }
  });

  it('reads digital silence as silent without asking the embedder', async () => {
    const r = await realnessOf(new Float32Array(48_000 * 2), {
      embedSegments: () => {
        throw new Error('no embedding for silence');
      },
    });
    expect(r.ok && r.value.verdict).toBe('silent');
    if (r.ok) expect(toSoundRealness(r.value)).toEqual({ pReal: null, verdict: 'silent' });
  });
});
