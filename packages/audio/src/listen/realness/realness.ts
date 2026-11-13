// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot realness: is a sound a real recording or a professional production (p_real high), or amateur code
 * synthesis? A sound up to 6 s is judged whole; a longer one in 4 s windows (the last aligned to the end unless that
 * adds under 0.25 s), each window through the CLAP head (and the weight-0 signal head), a pure tone capped at 0.03.
 * A long sound's p_real is the mean of its windows, its verdict on the file-level thresholds; each window keeps its
 * own (clip-level) verdict. Quiet sources are lifted to −30 dBFS RMS first; clips under −60 dBFS RMS are silent.
 * `toSoundRealness` gives core's SoundRealness.
 */
import { CancelledError, RationalTime, err, ok, type AsyncResult, type SoundRealness } from '@taalcut/core';
import { yieldAborted } from '../abort';
import { LISTEN_SR } from '../dsp/pcm';
import { ListenBadInput } from '../errors';
import {
  audible,
  liftQuiet,
  pureTone,
  signalFeatures,
  SIGNAL_FEATURES,
  type SignalFeatures,
} from './features';
import {
  closestPrompt,
  fuse,
  headLogit,
  realnessModel,
  thresholdsOf,
  verdictOf,
  type RealnessModel,
  type UpstreamRealnessVerdict,
} from './model';
import { pyRoundTo } from './py-round';

/** The CLAP audio encoder's `embedSegments` (models/clap-audio.ts): one unit embedding per ≤ 6 s segment. */
export interface RealnessEmbedder {
  embedSegments(segments: readonly Float32Array[], signal?: AbortSignal): AsyncResult<Float32Array[]>;
}

export interface RealnessSpan {
  /** Seconds from the start of what was judged. */
  readonly start: number;
  readonly end: number;
  readonly samples: Float32Array;
}

/** realness._clips with audio.windows(x, 4, 4, pad_last=True). */
export function realnessSpans(x: Float32Array, m: RealnessModel = realnessModel()): RealnessSpan[] {
  const n = x.length;
  if (n <= m.longS * LISTEN_SR) return [{ start: 0, end: n / LISTEN_SR, samples: x }];
  const w = Math.round(m.winS * LISTEN_SR);
  const starts: number[] = [];
  for (let s = 0; s + w <= n; s += w) starts.push(s);
  if ((n - w) % w) starts.push(n - w);
  const len = starts.length;
  if (len > 2 && ((starts[len - 1] ?? 0) - (starts[len - 2] ?? 0)) / LISTEN_SR < 0.25) starts.pop();
  return starts.map((s) => ({
    start: s / LISTEN_SR,
    end: s / LISTEN_SR + m.winS,
    samples: x.subarray(s, s + w),
  }));
}

export interface WindowScore {
  readonly features: SignalFeatures;
  readonly logits: { readonly clap: number; readonly signal: number };
  /** After the pure-tone rule. */
  readonly pReal: number;
  readonly tone: boolean;
}

/** score_clips for one live window: the heads from its CLAP logit (or embedding) and features. */
export function scoreWindow(
  features: SignalFeatures,
  clap: { readonly embedding: ArrayLike<number> } | { readonly logit: number },
  m: RealnessModel = realnessModel(),
): WindowScore {
  const lc = 'logit' in clap ? clap.logit : headLogit(m.heads.clap, clap.embedding);
  const ls = headLogit(
    m.heads.signal,
    SIGNAL_FEATURES.map((k) => features[k]),
  );
  const tone = pureTone(features);
  const p = fuse(m, { clap: lc, signal: ls });
  return { features, logits: { clap: lc, signal: ls }, pReal: tone ? Math.min(p, 0.03) : p, tone };
}

export type RealnessVerdictText = UpstreamRealnessVerdict | 'silent';

export interface RealnessSegment {
  readonly start: number;
  readonly end: number;
  /** 3 decimals; null for a silent window. */
  readonly pReal: number | null;
  readonly verdict: RealnessVerdictText;
}

export interface RealnessResult {
  readonly duration: number;
  /** 3 decimals, as upstream reports (and the critique scores); null when silent. */
  readonly pReal: number | null;
  readonly verdict: RealnessVerdictText;
  /** Judged in 4 s windows (over 6 s): the file-level thresholds apply. */
  readonly long: boolean;
  readonly gainDb: number;
  readonly segments?: readonly RealnessSegment[];
  /** Windows at or under the clip threshold (code-synthesized). */
  readonly synthWindows?: number;
  /** Windows under 0.5. */
  readonly leanSynthWindows?: number;
  readonly pRealMin?: number;
  readonly meanClapLogit?: number;
  /** Windows the pure-tone rule decided. */
  readonly toneWindows: number;
  /** D23: p_real within REALNESS_BORDERLINE of the threshold its verdict hangs on (isRealnessBorderline). */
  readonly borderline: boolean;
  /** The CLAP head's evidence on the most real (p ≥ 0.5) or most synthetic window, with the 12 prompts given. */
  readonly closest?: ReturnType<typeof closestPrompt>;
}

/** The result from each span's score (null: silent), as realness() assembles it. */
export function realnessFromScores(
  duration: number,
  spans: readonly Pick<RealnessSpan, 'start' | 'end'>[],
  scores: readonly (WindowScore | null)[],
  options: { readonly offset?: number; readonly gainDb?: number; readonly model?: RealnessModel } = {},
): RealnessResult {
  const m = options.model ?? realnessModel();
  const off = options.offset ?? 0;
  const gainDb = options.gainDb ?? 0;
  const live = scores.flatMap((s) => (s ? [s] : []));
  const toneWindows = live.filter((s) => s.tone).length;
  if (live.length === 0) {
    return { duration, pReal: null, verdict: 'silent', long: false, gainDb, toneWindows, borderline: false };
  }
  const long = spans.length > 1;
  const ps = live.map((s) => s.pReal);
  const p = ps.reduce((a, b) => a + b, 0) / ps.length;
  const pReal = pyRoundTo(p, 3);
  const borderline = isRealnessBorderline({ pReal, long }, m);
  const base = { duration, pReal, verdict: verdictOf(p, m, long), long, gainDb, toneWindows, borderline };
  if (!long) return base;
  const segments: RealnessSegment[] = spans.map((span, i) => {
    const s = scores[i];
    const start = pyRoundTo(off + span.start, 3);
    const end = pyRoundTo(off + Math.min(span.end, duration), 3);
    return s
      ? { start, end, pReal: pyRoundTo(s.pReal, 3), verdict: verdictOf(s.pReal, m) }
      : { start, end, pReal: null, verdict: 'silent' };
  });
  const lo = thresholdsOf(m).lo;
  const judged = segments.flatMap((s) => (s.pReal === null ? [] : [s.pReal]));
  return {
    ...base,
    segments,
    synthWindows: judged.filter((v) => v <= lo).length,
    leanSynthWindows: judged.filter((v) => v < 0.5).length,
    pRealMin: pyRoundTo(Math.min(...ps), 3),
    meanClapLogit: live.reduce((a, s) => a + s.logits.clap, 0) / live.length,
  };
}

export interface RealnessOptions {
  /** Where `mono` starts in its file (s): segment times stay file times. */
  readonly offset?: number;
  /** The 12 prompts' CLAP text embeddings (realnessPrompts order), for the closest-prompt evidence. */
  readonly prompts?: readonly Float32Array[];
  readonly signal?: AbortSignal;
  readonly model?: RealnessModel;
}

/** earshot realness(path) on decoded 48 kHz mono at ffmpeg `-ac 1`'s level (`audio.load(mono=True)`). */
export async function realnessOf(
  mono: Float32Array,
  embedder: RealnessEmbedder,
  options: RealnessOptions = {},
): AsyncResult<RealnessResult> {
  if (mono.length === 0) return err(ListenBadInput(undefined, { detail: 'no samples' }));
  const m = options.model ?? realnessModel();
  const lifted = liftQuiet(mono);
  const duration = lifted.x.length / LISTEN_SR;
  const spans = realnessSpans(lifted.x, m);
  // About 70–140 ms of CPU a window: a long sound stops between windows when its signal aborts (EAR1-R1).
  const features: (ReturnType<typeof signalFeatures> | null)[] = [];
  for (const s of spans) {
    if (await yieldAborted(options.signal)) return err(CancelledError());
    features.push(audible(s.samples, m.silentDb) ? signalFeatures(s.samples) : null);
  }
  const live = spans.filter((_, i) => features[i] !== null);
  const embedded =
    live.length > 0
      ? await embedder.embedSegments(
          live.map((s) => s.samples),
          options.signal,
        )
      : ok([]);
  if (!embedded.ok) return embedded;
  let k = 0;
  const embeddings: (Float32Array | null)[] = features.map((f) => (f ? (embedded.value[k++] ?? null) : null));
  const scores = features.map((f, i) => {
    const e = embeddings[i];
    return f && e ? scoreWindow(f, { embedding: e }, m) : null;
  });
  const result = realnessFromScores(duration, spans, scores, {
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    gainDb: lifted.gainDb,
    model: m,
  });
  if (!options.prompts || result.pReal === null) return ok(result);
  // The evidence window: the most real one when p ≥ 0.5, else the most synthetic.
  const realSide = (result.pReal ?? 0) >= 0.5;
  let pick = -1;
  scores.forEach((s, i) => {
    const best = pick >= 0 ? (scores[pick]?.pReal ?? 0) : null;
    if (s && (best === null || (realSide ? s.pReal > best : s.pReal < best))) pick = i;
  });
  const e = embeddings[pick];
  return ok(e ? { ...result, closest: closestPrompt(e, options.prompts, m) } : result);
}

/**
 * D23 for realness: a p_real this close to a threshold may read the other way on a quantised model, so its verdict
 * is borderline rather than firm. Measured (realness-e2e, 52 clips against upstream fp32): fp16 |Δp| ≤ 0.008, int8
 * ≤ 0.052.
 */
export const REALNESS_BORDERLINE = 0.05;

/** The verdict sits within REALNESS_BORDERLINE of a threshold (the file-level ones for a long sound). */
export function isRealnessBorderline(
  r: Pick<RealnessResult, 'pReal' | 'long'>,
  m: RealnessModel = realnessModel(),
): boolean {
  if (r.pReal === null) return false;
  const t = thresholdsOf(m, r.long);
  return Math.abs(r.pReal - t.lo) <= REALNESS_BORDERLINE || Math.abs(r.pReal - t.hi) <= REALNESS_BORDERLINE;
}

const MS_RATE = { num: 1000, den: 1 } as const;
const VERDICTS = {
  'real or pro-produced': 'real',
  uncertain: 'uncertain',
  'likely code-synthesized': 'synthetic',
  silent: 'silent',
} as const satisfies Record<RealnessVerdictText, SoundRealness['verdict']>;

/** Core's SoundRealness: p_real, the verdict (D23's borderline when set) and, over 6 s, the 4 s windows (1 ms). */
export function toSoundRealness(r: RealnessResult): SoundRealness {
  return {
    pReal: r.pReal === null ? null : Math.min(1, Math.max(0, r.pReal)),
    verdict: VERDICTS[r.verdict],
    ...(r.borderline ? { borderline: true } : {}),
    ...(r.segments
      ? {
          windows: r.segments.map((s) => ({
            start: RationalTime.fromSeconds(s.start, MS_RATE),
            end: RationalTime.fromSeconds(Math.max(s.end, s.start + 0.001), MS_RATE),
            pReal: s.pReal === null ? null : Math.min(1, Math.max(0, s.pReal)),
          })),
        }
      : {}),
  };
}

const FROM_CORE = {
  real: 'real or pro-produced',
  uncertain: 'uncertain',
  synthetic: 'likely code-synthesized',
  silent: 'silent',
} as const satisfies Record<SoundRealness['verdict'], RealnessVerdictText>;

/** Core's SoundRealness back as what the critique reads (p_real, the windows and their clip verdicts). */
export function realnessFromSound(r: SoundRealness, m: RealnessModel = realnessModel()): RealnessResult {
  const segments = r.windows?.map((w): RealnessSegment => {
    const start = RationalTime.toSeconds(w.start);
    const end = RationalTime.toSeconds(w.end);
    return { start, end, pReal: w.pReal, verdict: w.pReal === null ? 'silent' : verdictOf(w.pReal, m) };
  });
  const lo = thresholdsOf(m).lo;
  const judged = segments?.flatMap((s) => (s.pReal === null ? [] : [s.pReal])) ?? [];
  const long = segments !== undefined;
  return {
    duration: segments?.at(-1)?.end ?? 0,
    pReal: r.pReal,
    verdict: FROM_CORE[r.verdict],
    long,
    gainDb: 0,
    toneWindows: 0,
    borderline: isRealnessBorderline({ pReal: r.pReal, long }, m),
    ...(segments
      ? {
          segments,
          synthWindows: judged.filter((v) => v <= lo).length,
          leanSynthWindows: judged.filter((v) => v < 0.5).length,
          ...(judged.length ? { pRealMin: Math.min(...judged) } : {}),
        }
      : {}),
  };
}
