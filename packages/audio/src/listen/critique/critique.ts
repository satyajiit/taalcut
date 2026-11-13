// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot critique: a soundtrack or film against a reference profile (the 7 bundled launch films, or the template
 * reel's own sound), 23 scored metrics with weights 3/2/1, the verdict bands and timestamped fixes. The model
 * passes are inputs: `realness` (realness.ts, CLAP) and `music` (the AudioSet 5 s windows, metrics-time.ts); either
 * missing makes the critique partial, as `earshot critique --fast` does. Files under 3 s or silent are not scored.
 * `toSoundCritique` gives core's SoundCritique (null when nothing was scored).
 */
import {
  RationalTime,
  SOUND_CRITIQUE_METRICS,
  type CutSyncReport,
  type SoundCritique,
  type SoundCritiqueFix,
  type SoundCritiqueMetricId,
  type SoundCritiqueProfile,
} from '@taalcut/core';
import type { Measurements } from '../dsp/measure';
import { LISTEN_SR, stereoOf, type ListenAudio } from '../dsp/pcm';
import { pyRoundTo } from '../realness/py-round';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { analyseEvents, type EventAnalysis } from '../timeline/events';
import { syncToCuts, type SyncResult } from '../timeline/sync';
import type { RealnessResult } from '../realness/realness';
import { audioPass, type AudioPass } from './audio-pass';
import { MIN_SCORABLE_S, SHAPE_METRICS, filmMetrics, type FilmMetrics, type FilmPicture } from './film';
import { metricFixes, missingOf, tipFixes, unansweredCuts, type CritiqueCommands } from './fixes';
import type { MusicWindow } from './metrics-time';
import { launchProfile, leaveOneOut, referenceMatch, type CritiqueProfile } from './profile';
import {
  CRITIQUE_SPEC,
  scorecard,
  type CritiqueRowId,
  type ScoreRow,
  type UpstreamVerdict,
} from './scorecard';

export interface CritiqueInput {
  /** The decoded mix, 48 kHz (earshot `audio.load`: stereo, or mono duplicated). */
  readonly audio: ListenAudio;
  readonly runner: SpectrogramRunner;
  /** The picture's cuts; without them the sync metrics are n.a. */
  readonly picture?: FilmPicture | null;
  /** Default: the bundled launch profile. */
  readonly profile?: CritiqueProfile;
  readonly profileKind?: SoundCritiqueProfile;
  /** Audio decoded from AAC / MP3 / Opus: true peak is judged against 0 dBTP. */
  readonly lossy?: boolean;
  /** The AudioSet windows; undefined when the pass didn't run (fast), null when it couldn't. */
  readonly music?: readonly MusicWindow[] | null;
  /** Realness of the mix (models' mono); undefined when not run, null when it couldn't. */
  readonly realness?: RealnessResult | null;
  /** F6's event analysis of the same audio, reused for the cut sync. */
  readonly events?: EventAnalysis;
  /** F6's sync of the same cuts (in picture order), reused as it is. */
  readonly sync?: SyncResult;
  /** Or core's report of it (an analysis's `cutSync`): what the fixes read of it is there. */
  readonly cutSync?: CutSyncReport;
  /** The light measurements, when an analysis already made them (audio-pass.ts `measurementsOf`). */
  readonly meas?: Measurements;
  readonly beats?: readonly number[];
  readonly tempo?: number | null;
  readonly commands?: CritiqueCommands;
  /** Stops between steps (abort.ts `checkpoint`: it unwinds; the analysis returns core.cancelled). */
  readonly signal?: AbortSignal;
}

export type NotMeasuredReason =
  'not_run' | 'unavailable' | 'no_picture' | 'few_cuts' | 'short' | 'not_measurable';

export interface CritiqueResult {
  readonly profileKind: SoundCritiqueProfile;
  readonly duration: number;
  /** 'short' (under 3 s) or 'silent' (nothing above −70 LUFS): not scored. */
  readonly unscorable: 'short' | 'silent' | null;
  readonly verdict: UpstreamVerdict;
  readonly score: number | null;
  readonly inRange: number;
  readonly scored: number;
  readonly criticalIssues: number;
  readonly majorIssues: number;
  /** Upstream's partial list: the critical model checks that did not run. */
  readonly partial: readonly ('realness' | 'music presence')[];
  readonly rows: readonly ScoreRow[];
  /** Most important first, the tips after. */
  readonly fixes: readonly SoundCritiqueFix[];
  /** Set when the file is one of the profile's films: scored against the others. */
  readonly referenceMatch: { readonly id: string; readonly scoredAgainst: number } | null;
  readonly events: {
    readonly visual: readonly number[];
    readonly visualWithoutOnset: readonly number[];
    readonly visualWithoutAnySound: readonly number[] | null;
    readonly visualWithoutHit: readonly number[];
    readonly hits: readonly number[];
  };
  readonly notMeasured: Readonly<Partial<Record<NotMeasuredReason, readonly CritiqueRowId[]>>>;
  readonly film: FilmMetrics | null;
  readonly pass: AudioPass | null;
  readonly sync: SyncResult | null;
}

/** What the critique reads of a sync (each cut's status and time) from core's report of it. */
export function syncFromReport(report: CutSyncReport): SyncResult {
  const items = report.items.map((item) => ({
    cutIndex: item.cutIndex,
    t: pyRoundTo(RationalTime.toSeconds(item.at), 3),
    status: item.status,
    offsetMs: item.offsetMs,
    accentOffsetMs: item.accentOffsetMs ?? null,
  }));
  return {
    items,
    stats: {
      n: items.length,
      okShare: report.okShare,
      nearShare: report.nearShare,
      medianAbsOffsetMs: report.medianOffsetMs,
      answeredBySwell: items.filter((i) => i.status === 'swell').length,
      answeredByLevelPeak: items.filter((i) => i.status === 'peak').length,
      noSound: items.filter((i) => i.status === 'none' || i.status === 'off').map((i) => i.t),
      toleranceMs: report.toleranceMs,
    },
  };
}

function naReason(id: CritiqueRowId, input: CritiqueInput, film: FilmMetrics): NotMeasuredReason {
  if (id === 'pReal') return input.realness === undefined ? 'not_run' : 'unavailable';
  if (id === 'musicFrac') return input.music === undefined ? 'not_run' : 'unavailable';
  if (id === 'cutsWithSound') return film.picture ? 'few_cuts' : 'no_picture';
  if ((SHAPE_METRICS as readonly CritiqueRowId[]).includes(id) && film.short) return 'short';
  return 'not_measurable';
}

function emptyResult(kind: SoundCritiqueProfile, duration: number, why: 'short' | 'silent'): CritiqueResult {
  return {
    profileKind: kind,
    duration,
    unscorable: why,
    verdict: 'n.a.',
    score: null,
    inRange: 0,
    scored: 0,
    criticalIssues: 0,
    majorIssues: 0,
    partial: [],
    rows: [],
    fixes: [],
    referenceMatch: null,
    events: {
      visual: [],
      visualWithoutOnset: [],
      visualWithoutAnySound: null,
      visualWithoutHit: [],
      hits: [],
    },
    notMeasured: {},
    film: null,
    pass: null,
    sync: null,
  };
}

/** earshot critique(path, profile, video, use_ast, use_realness) on decoded audio and the given model passes. */
export async function critiqueSound(input: CritiqueInput): Promise<CritiqueResult> {
  const kind = input.profileKind ?? 'launch';
  const n = stereoOf(input.audio).length;
  const dur0 = n / LISTEN_SR;
  if (dur0 < MIN_SCORABLE_S) return emptyResult(kind, dur0, 'short');
  const { signal } = input;
  const pass = await audioPass(input.audio, input.runner, {
    ...(input.events ? { kPower: input.events.kPower } : {}),
    ...(signal ? { signal } : {}),
  });
  const lufs = pass.meas.lufs;
  if (lufs === undefined || lufs <= -69.5) return emptyResult(kind, pass.meas.duration, 'silent');
  const film = filmMetrics({
    pass,
    picture: input.picture ?? null,
    music: input.music ?? null,
    ...(input.beats ? { beats: input.beats } : {}),
    ...(input.tempo !== undefined ? { tempo: input.tempo } : {}),
  });
  let profile = input.profile ?? launchProfile();
  const ref = referenceMatch(film, profile);
  if (ref) profile = leaveOneOut(profile, ref);
  let sync: SyncResult | null = input.sync ?? (input.cutSync ? syncFromReport(input.cutSync) : null);
  if (!sync && film.events.visual.length > 0) {
    const events = input.events ?? (await analyseEvents(input.audio, input.runner, signal ? { signal } : {}));
    sync = syncToCuts(film.events.visual, events.events, {
      ...(film.frameRate ? { frameRate: film.frameRate } : {}),
      levels: events.levels,
    });
  }
  const pReal = input.realness?.pReal ?? null;
  const card = scorecard({ ...film.metrics, pReal }, profile, film.chance, input.lossy ?? false);
  const flagged: Array<{ row: ScoreRow; dist: number; fixes: SoundCritiqueFix[] }> = [];
  const ctx = {
    film,
    pass,
    sync,
    realness: input.realness ?? null,
    lossy: input.lossy ?? false,
    ...(input.commands ? { commands: input.commands } : {}),
  };
  for (const row of card.rows) {
    if ((row.status !== 'low' && row.status !== 'high') || row.value === null) continue;
    const edge = row.status === 'low' ? row.range[0] : row.range[1];
    const tol = CRITIQUE_SPEC[row.id].tol;
    const refs = row.id === 'pReal' ? { n: 0 } : profile.metrics[row.id];
    const fixes = metricFixes(row.id, row.status, row.value, refs, ctx);
    if (fixes.length > 0)
      flagged.push({ row, dist: Math.abs(row.value - (edge ?? 0)) / Math.max(tol, 1e-3), fixes });
  }
  flagged.sort((a, b) => b.row.weight - a.row.weight || b.dist - a.dist);
  const tips = tipFixes(ctx, new Set(flagged.map((f) => f.row.id)), pReal);
  const notMeasured: Partial<Record<NotMeasuredReason, CritiqueRowId[]>> = {};
  for (const row of card.rows) {
    if (row.status !== 'na' || CRITIQUE_SPEC[row.id].weight === 0) continue;
    const why = naReason(row.id, input, film);
    (notMeasured[why] ??= []).push(row.id);
  }
  const partial: ('realness' | 'music presence')[] = [];
  if (pReal === null) partial.push('realness');
  if (film.metrics.musicFrac === null) partial.push('music presence');
  const un = unansweredCuts(sync);
  return {
    profileKind: kind,
    duration: film.duration,
    unscorable: null,
    verdict: card.verdict,
    score: card.score,
    inRange: card.inRange,
    scored: card.scored,
    criticalIssues: card.criticalIssues,
    majorIssues: card.majorIssues,
    partial,
    rows: card.rows,
    fixes: [...flagged.flatMap((f) => f.fixes), ...tips],
    referenceMatch: ref ? { id: ref, scoredAgainst: profile.n } : null,
    events: {
      visual: film.events.visual,
      visualWithoutOnset: missingOf(film.events.visual, pass.onsets),
      visualWithoutAnySound: un ? un.none : null,
      visualWithoutHit: missingOf(film.events.visual, film.events.hits),
      hits: film.events.hits,
    },
    notMeasured,
    film,
    pass,
    sync,
  };
}

const VERDICTS = {
  'launch-grade': 'launch_grade',
  close: 'close',
  'needs work': 'needs_work',
  'not launch-grade': 'not_launch_grade',
} as const satisfies Partial<Record<UpstreamVerdict, SoundCritique['verdict']>>;

/** The most fixes core's SoundCritique carries. */
const MAX_FIXES = 30;

/** Core's SoundCritique: the 23 scored rows, the verdict, the fixes (30 at most); null when nothing was scored. */
export function toSoundCritique(result: CritiqueResult): SoundCritique | null {
  if (result.score === null || result.verdict === 'n.a.') return null;
  const scoredIds: readonly string[] = SOUND_CRITIQUE_METRICS;
  const metrics = result.rows
    .filter((r) => scoredIds.includes(r.id))
    .map((r) => ({
      id: r.id as SoundCritiqueMetricId,
      weight: (r.weight || CRITIQUE_SPEC[r.id].weight || 1) as 1 | 2 | 3,
      value: r.value,
      range: r.basis === 'no reference data' ? null : { min: r.range[0], max: r.range[1] },
      status: r.status === 'info' ? ('na' as const) : r.status,
    }));
  return {
    profile: result.profileKind,
    verdict: VERDICTS[result.verdict],
    score: Math.min(1, Math.max(0, result.score)),
    partial: metrics.some((m) => m.status === 'na'),
    metrics,
    fixes: result.fixes.slice(0, MAX_FIXES),
  };
}
