// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-parity's critique (EAR1-A1): @taalcut/audio's `critiqueSound` on the 10 fixture films, against upstream
 * earshot's `critique film.wav --video film.mp4`, with the picture's cuts upstream detected (they equal the planted
 * cuts) at 30 fps.
 *
 * - With upstream's model passes (no model): realness from `earshot realness`, and the AudioSet music and speech
 *   windows from a stand-in tagger that answers upstream's shares through audio's own `musicWindows`. Every metric
 *   row agrees when its status, weight and range are upstream's and its value is within its unit's tolerance (the
 *   plan's: LUFS, LU and dB ±0.1, seconds ±5 ms, shares and rates ±0.01); a film agrees when its verdict, score and
 *   counts are upstream's.
 * - End to end (one dtype): our AST and CLAP passes; the verdicts and every scored row's status.
 */
import {
  critiqueSound,
  FILM_METRICS,
  musicWindows,
  type AstTagger,
  type MusicWindow,
  type RealnessResult,
  type SpectrogramRunner,
} from '@taalcut/audio';
import { ok } from '@taalcut/core';
import { clips, cliRun, ffmpegMono, loadClip } from '../../../earshot-parity/fixtures.mjs';
import type { ListenDtype } from '../listening/environment';
import type { MeasuredMetric } from '../listening/outcome';
import type { UpstreamRealness } from './realness';
import { share } from './stats';

interface UpstreamRow {
  readonly metric: string;
  readonly value: number | null;
  readonly range: readonly [number | null, number | null];
  readonly status: string;
  readonly weight: 'critical' | 'major' | 'minor' | 'info';
}

interface UpstreamCritique {
  readonly verdict: string;
  readonly score: number;
  readonly in_range: number;
  readonly scored: number;
  readonly critical_issues: number;
  readonly major_issues: number;
  readonly metrics: readonly UpstreamRow[];
  readonly events: Readonly<Record<string, readonly number[]>>;
}

const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const WEIGHT = { critical: 3, major: 2, minor: 1, info: 0 } as const;
/** Not ported: librosa's beat_track (both info rows, never scored). */
const NOT_PORTED = new Set(['tempo', 'cuts_on_beat']);
const FILM_FPS = { num: 30, den: 1 };

/** The plan's tolerance for a metric, by its unit. */
export function tolerance(id: string): number {
  if (id === 'pReal') return 0.01;
  const unit = (FILM_METRICS as Readonly<Record<string, readonly [string, string, number]>>)[id]?.[1];
  if (unit === 's') return 0.005;
  if (unit === 'Hz' || unit === 'BPM') return 1;
  return unit !== undefined && ['share', '/s', '/min', '0-1', 'r'].includes(unit) ? 0.01 : 0.1;
}

/** An AudioSet tagger that answers `music` and `speech` as shares of the windows it is given (the first ones). */
export function shareTagger(music: number | null, speech: number | null): AstTagger {
  return {
    labels: async () => ok(['Music', 'Speech']),
    features: async () => [],
    probs: async (sources) => {
      const n = sources.length;
      const kMusic = Math.round((music ?? 0) * n);
      const kSpeech = Math.round((speech ?? 0) * n);
      return ok(
        sources.map((_, i) => ({
          logits: [],
          probs: Float32Array.of(i < kMusic ? 0.9 : 0.1, i < kSpeech ? 0.9 : 0.1),
        })),
      );
    },
  };
}

/** Upstream's realness run as the critique reads it. */
export function realnessFromCli(cli: UpstreamRealness): RealnessResult {
  return {
    duration: cli.duration,
    pReal: cli.p_real,
    verdict: cli.verdict,
    long: Boolean(cli.segments),
    gainDb: 0,
    toneWindows: 0,
    borderline: false,
    ...(cli.segments
      ? {
          segments: cli.segments.map((s) => ({
            start: s.start,
            end: s.end,
            pReal: s.p_real,
            verdict: s.verdict,
          })),
          ...(cli.synth_windows !== undefined ? { synthWindows: cli.synth_windows } : {}),
        }
      : {}),
  };
}

interface FilmPasses {
  readonly music: readonly MusicWindow[];
  readonly realness: RealnessResult;
}

async function critiqueFilm(id: string, runner: SpectrogramRunner, passes: FilmPasses) {
  const up = cliRun<UpstreamCritique>('critique', id);
  const clip = loadClip(id);
  const r = await critiqueSound({
    audio: { sampleRate: clip.sampleRate, channels: clip.channels },
    runner,
    picture: { cuts: up.events['visual'] ?? [], frameRate: FILM_FPS },
    music: passes.music,
    realness: passes.realness,
  });
  return { up, r };
}

/** With upstream's model passes: every row, and each film's verdict and counts. */
export async function critiqueWithUpstreamPasses(
  runner: SpectrogramRunner,
  notes: string[],
): Promise<MeasuredMetric[]> {
  const films = clips('film').map((c) => c.id);
  let rows = 0;
  let rowsAgree = 0;
  let filmsAgree = 0;
  for (const id of films) {
    const up = cliRun<UpstreamCritique>('critique', id);
    const value = (metric: string) => up.metrics.find((m) => m.metric === metric)?.value ?? null;
    const mono = ffmpegMono(loadClip(id));
    const music = await musicWindows(shareTagger(value('music_frac'), value('speech_frac')), mono);
    if (!music.ok) throw new Error(`listen-parity: music windows on ${id}: ${music.error.code}`);
    const realness = realnessFromCli(cliRun<UpstreamRealness>('realness', id));
    const { r } = await critiqueFilm(id, runner, { music: music.value, realness });
    for (const row of up.metrics) {
      if (NOT_PORTED.has(row.metric)) continue;
      rows += 1;
      const mine = r.rows.find((x) => x.id === camel(row.metric));
      const agrees =
        mine !== undefined &&
        mine.status === (row.status === 'n.a.' ? 'na' : row.status) &&
        mine.weight === WEIGHT[row.weight] &&
        (row.value === null
          ? mine.value === null
          : Math.abs((mine.value ?? Number.NaN) - row.value) <= tolerance(mine.id) + 1e-9) &&
        mine.range[0] === row.range[0] &&
        mine.range[1] === row.range[1];
      if (agrees) rowsAgree += 1;
      else
        notes.push(
          `- ${id} ${row.metric}: ${mine?.value} ${mine?.status} where upstream says ${row.value} ${row.status}`,
        );
    }
    const ours = [r.verdict, r.score, r.inRange, r.scored, r.criticalIssues, r.majorIssues];
    const theirs = [up.verdict, up.score, up.in_range, up.scored, up.critical_issues, up.major_issues];
    if (ours.every((v, i) => v === theirs[i])) filmsAgree += 1;
    else notes.push(`- ${id}: ${ours.join(' ')} where upstream says ${theirs.join(' ')}`);
  }
  const part = 'critique';
  return [
    {
      name: 'critiqueMetricAgreement',
      value: share(rowsAgree, rows),
      better: 'higher',
      part,
      over: `${rows} metric rows in ${films.length} films`,
    },
    {
      name: 'critiqueVerdictAgreement',
      value: share(filmsAgree, films.length),
      better: 'higher',
      part,
      over: `${films.length} films (verdict, score and counts)`,
    },
  ];
}

/** End to end in one dtype: our AST windows and the realness end to end already measured. */
export async function critiqueEndToEnd(
  ast: AstTagger,
  realness: ReadonlyMap<string, RealnessResult>,
  runner: SpectrogramRunner,
  dtype: ListenDtype,
  notes: string[],
): Promise<MeasuredMetric[]> {
  const films = clips('film').map((c) => c.id);
  let verdicts = 0;
  let rows = 0;
  let statuses = 0;
  for (const id of films) {
    const music = await musicWindows(ast, ffmpegMono(loadClip(id)));
    const real = realness.get(id);
    if (!music.ok || !real) throw new Error(`listen-parity: ${dtype} model passes on ${id} failed`);
    const { up, r } = await critiqueFilm(id, runner, { music: music.value, realness: real });
    if (r.verdict === up.verdict) verdicts += 1;
    else
      notes.push(`- ${id} (${dtype}): ${r.verdict} ${r.score} where upstream says ${up.verdict} ${up.score}`);
    for (const row of up.metrics) {
      if (row.weight === 'info') continue;
      rows += 1;
      const mine = r.rows.find((x) => x.id === camel(row.metric));
      if ((mine?.status === 'na' ? 'n.a.' : mine?.status) === row.status) statuses += 1;
      else
        notes.push(
          `- ${id} ${row.metric} (${dtype}): ${mine?.value} ${mine?.status} where upstream says ${row.value} ${row.status}`,
        );
    }
  }
  return [
    {
      name: `${dtype}CritiqueVerdictAgreement`,
      value: share(verdicts, films.length),
      better: 'higher',
      part: dtype,
      over: `${films.length} films`,
    },
    {
      name: `${dtype}CritiqueStatusAgreement`,
      value: share(statuses, rows),
      better: 'higher',
      part: dtype,
      over: `${rows} scored rows`,
    },
  ];
}
