// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1 critique against upstream earshot on the 10 fixture films (tools/earshot-parity, `earshot critique
 * film.wav --video film.mp4`). The picture's cuts are upstream's detected visual events (equal to the planted cuts);
 * the model passes are upstream's own: realness from `earshot realness` and the AudioSet music and speech shares as
 * windows that give the same shares (the CI has no models; critique-e2e runs both). Everything else (loudness, the
 * arc and ending, librosa's onsets, salient hits, sync, spectrum, stereo) is computed here. Done when (plan): every
 * metric within tolerance (LUFS ±0.1, timing ±5 ms, ratios ±0.01) with identical statuses and verdicts.
 */
import { soundCritiqueFixSchema, soundCritiqueSchema } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { clips, cliRun, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import { critiqueSound, toSoundCritique } from '../../src/listen/critique/critique';
import { CRITIQUE_MESSAGE_KEYS } from '../../src/listen/critique/fixes';
import { musicWindowStarts, type MusicWindow } from '../../src/listen/critique/metrics-time';
import { FILM_METRICS, type FilmMetricId } from '../../src/listen/critique/profile';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { realnessFromCli, type UpstreamRealness } from './realness-helpers';

interface UpstreamRow {
  readonly metric: string;
  readonly value: number | null;
  readonly range: readonly [number | null, number | null];
  readonly status: 'ok' | 'low' | 'high' | 'n.a.' | 'info';
  readonly weight: 'critical' | 'major' | 'minor' | 'info';
}
interface UpstreamCritique {
  readonly verdict: string;
  readonly score: number;
  readonly in_range: number;
  readonly scored: number;
  readonly critical_issues: number;
  readonly major_issues: number;
  readonly partial: readonly string[];
  readonly metrics: readonly UpstreamRow[];
  readonly actions: readonly { readonly metric: string }[];
  readonly tips: readonly string[];
  readonly events: Readonly<Record<string, readonly number[]>>;
}

const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const WEIGHT = { critical: 3, major: 2, minor: 1, info: 0 } as const;
/** Not ported: librosa's beat_track (both info rows, never scored). */
const NOT_PORTED = new Set(['tempo', 'cuts_on_beat']);

/** Per unit: LUFS / LU / dB ±0.1, seconds ±5 ms, shares and rates ±0.01. */
function tolerance(id: string): number {
  if (id === 'pReal') return 0.01;
  const unit = FILM_METRICS[id as FilmMetricId][1];
  return unit === 's'
    ? 0.005
    : unit === 'Hz'
      ? 1
      : unit === 'BPM'
        ? 1
        : ['share', '/s', '/min', '0-1', 'r'].includes(unit)
          ? 0.01
          : 0.1;
}

/** Windows whose AudioSet shares equal upstream's (its windows aren't in the fixtures; critique-e2e runs AST). */
function windowsGiving(samples: number, music: number | null, speech: number | null): MusicWindow[] {
  const starts = musicWindowStarts(samples);
  const n = starts.length;
  const kMusic = Math.round((music ?? 0) * n);
  const kSpeech = Math.round((speech ?? 0) * n);
  return starts.map((s, i) => ({
    t: s / 48_000,
    music: i < kMusic ? 0.9 : 0.1,
    speech: i < kSpeech ? 0.9 : 0.1,
  }));
}

const runner = createSpectrogramRunner();
afterAll(() => runner.release());
const films = clips('film').map((c) => c.id);

describe('critique against upstream on the fixture films', () => {
  it.each(films)(
    '%s: every metric, status, weight and range; the verdict, score and fix order',
    async (id) => {
      const up = cliRun<UpstreamCritique>('critique', id);
      const clip = loadClip(id);
      const value = (metric: string) => up.metrics.find((m) => m.metric === metric)?.value ?? null;
      const r = await critiqueSound({
        audio: { sampleRate: clip.sampleRate, channels: clip.channels },
        runner,
        picture: { cuts: up.events['visual'] ?? [], frameRate: { num: 30, den: 1 } },
        music: windowsGiving(clip.channels[0]?.length ?? 0, value('music_frac'), value('speech_frac')),
        realness: realnessFromCli(cliRun<UpstreamRealness>('realness', id)),
      });
      for (const row of up.metrics) {
        if (NOT_PORTED.has(row.metric)) continue;
        const mine = r.rows.find((x) => x.id === camel(row.metric));
        expect(mine, row.metric).toBeDefined();
        if (!mine) continue;
        const label = `${id} ${row.metric}: ${row.value} vs ${mine.value}`;
        expect(mine.status, label).toBe(row.status === 'n.a.' ? 'na' : row.status);
        expect(mine.weight, label).toBe(WEIGHT[row.weight]);
        if (row.value === null) expect(mine.value, label).toBeNull();
        else
          expect(Math.abs((mine.value ?? Number.NaN) - row.value), label).toBeLessThanOrEqual(
            tolerance(mine.id),
          );
        expect([mine.range[0], mine.range[1]], label).toEqual([row.range[0], row.range[1]]);
      }
      expect([r.verdict, r.score, r.inRange, r.scored, r.criticalIssues, r.majorIssues]).toEqual([
        up.verdict,
        up.score,
        up.in_range,
        up.scored,
        up.critical_issues,
        up.major_issues,
      ]);
      expect(r.partial).toEqual(up.partial);
      const order = [
        ...new Set(
          r.fixes.flatMap((f) => (f.messageKey.includes('.fix.') && f.metricId ? [f.metricId] : [])),
        ),
      ];
      expect(order).toEqual(up.actions.map((a) => camel(a.metric)));
      expect(r.fixes.filter((f) => f.messageKey.includes('.tip.')).length).toBe(up.tips.length);
      const events = {
        visual_without_onset: r.events.visualWithoutOnset,
        visual_without_any_sound: r.events.visualWithoutAnySound ?? [],
        visual_without_hit: r.events.visualWithoutHit,
        hits: r.events.hits,
      };
      for (const [key, ours] of Object.entries(events)) {
        const theirs = up.events[key] ?? [];
        expect(ours.length, `${id} ${key}`).toBe(theirs.length);
        ours.forEach((t, i) =>
          expect(Math.abs(t - (theirs[i] ?? Number.NaN)), `${id} ${key}[${i}]`).toBeLessThanOrEqual(0.005),
        );
      }
      const keys: readonly string[] = CRITIQUE_MESSAGE_KEYS;
      for (const f of r.fixes) {
        expect(keys).toContain(f.messageKey);
        expect(soundCritiqueFixSchema.safeParse(f).success, f.messageKey).toBe(true);
      }
      const core = toSoundCritique(r);
      expect(soundCritiqueSchema.safeParse(core).success).toBe(true);
      expect(core?.metrics).toHaveLength(23);
    },
  );
});
