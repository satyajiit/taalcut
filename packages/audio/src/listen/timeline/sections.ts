// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sections (EAR1-F5, timeline.py `sections`): 3 s CLAP windows every 2 s (the hop grows so a long sound keeps at most
 * 32), merged with their neighbour while their mean embeddings stay alike (cosine ≥ 0.84) and no Foote novelty peak
 * (z ≥ 3) sits between them, until at most one section per 8 s is left; anything under 4 s merges anyway. Each
 * boundary moves to the strongest spectral change near it, slivers merge away, and each section gets its genre,
 * mood, instrument, ambience and voice tags (plain z over the vocabulary: hints), AST's Music, Speech and Silence
 * (3 centred 10.24 s crops, longest sections first), its loudness and a label; neighbours that read alike merge.
 *
 * Input is timeline.py's mono: the stereo mean, a mono source at unity (`timelineMono`).
 */
import { ok, type AsyncResult, type SoundSection, type SoundTag, type SoundTagCategory } from '@taalcut/core';
import { roundTo } from '../calibrate/verdict';
import { dot, type ListenVocab } from '../calibrate/vocab';
import { LISTEN_CONFIG } from '../config';
import type { ListenModels } from '../describe/context';
import { topLabels } from '../models/ast';
import { meanUnit } from '../models/clap-audio';
import { measureBs1770Loudness } from '../../mix/bs1770-loudnorm';
import { msTime } from '../../rates';
import { labelKey, sectionLabel, type SectionPresence, type SectionTag } from './sections-label';
import { noveltyBounds, refineBoundary } from './sections-novelty';

const SR = LISTEN_CONFIG.sampleRate;
const CFG = LISTEN_CONFIG.sections;
const AST_WIN_S = 10.24;
const TAG_CATEGORIES = ['music_genre', 'music_mood', 'instruments', 'ambience', 'voice'] as const;

export interface ListenSection {
  readonly start: number;
  readonly end: number;
  readonly windows: number;
  readonly coherence: number;
  readonly genre: readonly SectionTag[];
  readonly mood: readonly SectionTag[];
  readonly instruments: readonly SectionTag[];
  readonly ambience: readonly SectionTag[];
  readonly voice: readonly SectionTag[];
  readonly lufs: number | null;
  readonly silent: boolean;
  readonly presence: SectionPresence | null;
  readonly audioSet: readonly { readonly label: string; readonly score: number }[] | null;
  readonly label: string;
}

export interface SectionsResult {
  readonly sections: readonly ListenSection[];
  /** CLAP windows and AST crops run. */
  readonly windows: number;
  readonly astWindows: number;
  readonly novelty: readonly (readonly [number, number])[];
}

type Draft = Omit<ListenSection, 'label'> & { label?: string };

/** timeline._seg: [⌊a·SR⌋, max(⌊a·SR⌋ + 480, ⌊b·SR⌋)). */
const crop = (x: Float32Array, a: number, b: number): Float32Array => {
  const start = Math.max(0, Math.trunc(a * SR));
  return x.subarray(start, Math.max(Math.trunc(a * SR) + 480, Math.trunc(b * SR)));
};

/** timeline._section_level: integrated loudness as upstream's stereo read sees it (a mono source counts twice). */
function level(x: Float32Array, start: number, end: number): { lufs: number | null; silent: boolean } {
  const xs = x.subarray(Math.trunc(start * SR), Math.trunc(end * SR));
  let peak = 0;
  for (const v of xs) peak = Math.max(peak, Math.abs(v));
  const integrated =
    xs.length > 0.4 * SR ? measureBs1770Loudness(xs, SR).integratedLufs + 10 * Math.log10(2) : null;
  return {
    lufs: integrated !== null && integrated > -70 ? roundTo(integrated, 1) : null,
    silent: xs.length > 0 && peak === 0,
  };
}

/** timeline._zscores + _top: the two best terms of a category for one section embedding. */
function sectionTags(
  v: Float32Array,
  vocab: ListenVocab,
): Record<(typeof TAG_CATEGORIES)[number], SectionTag[]> {
  const cos = vocab.rows.map((row) => dot(v, row));
  const mean = cos.reduce((s, c) => s + c, 0) / cos.length;
  const std = Math.sqrt(cos.reduce((s, c) => s + (c - mean) ** 2, 0) / cos.length) + 1e-9;
  const order = cos.map((_, i) => i).sort((a, b) => (cos[b] ?? 0) - (cos[a] ?? 0));
  const top = (category: string): SectionTag[] =>
    order
      .filter((i) => vocab.categories[i] === category)
      .slice(0, 2)
      .map((i) => ({
        term: vocab.terms[i] ?? '',
        category: vocab.categories[i] as SoundTagCategory,
        z: roundTo(((cos[i] ?? 0) - mean) / std, 2),
        cosine: roundTo(cos[i] ?? 0, 3),
      }));
  return Object.fromEntries(TAG_CATEGORIES.map((c) => [c, top(c)])) as Record<
    (typeof TAG_CATEGORIES)[number],
    SectionTag[]
  >;
}

/** The 3 s window starts: `np.arange(0, max(dur − win, 0) + 1e-6, hop)`, plus one flush with the end if needed. */
export function sectionSpans(duration: number, win: number, hop: number): [number, number][] {
  const stop = Math.max(duration - win, 0) + 1e-6;
  const starts = Array.from({ length: Math.ceil(stop / hop) }, (_, k) => k * hop);
  const last = starts.at(-1);
  if (last === undefined || last + win < duration - 0.5) starts.push(Math.max(0, duration - win));
  return starts.map((s) => [roundTo(s, 3), roundTo(Math.min(duration, s + win), 3)]);
}

/** The merge of windows into contiguous runs (indices into `spans`). */
export function mergeWindows(
  spans: readonly [number, number][],
  rows: readonly Float32Array[],
  novelty: readonly number[],
  duration: number,
  win: number,
  hop: number,
): number[][] {
  const segs = spans.map((_, i) => [i]);
  const mean = (seg: number[]) => meanUnit(seg.map((i) => rows[i] ?? new Float32Array()));
  const length = (seg: number[]) => (spans[seg.at(-1) ?? 0]?.[1] ?? 0) - (spans[seg[0] ?? 0]?.[0] ?? 0);
  const blocked = (a: number[], b: number[]) => {
    const bStart = spans[b[0] ?? 0]?.[0] ?? 0;
    const aEnd = spans[a.at(-1) ?? 0]?.[1] ?? 0;
    const j = bStart + (bStart >= aEnd ? win : aEnd - bStart) / 2;
    return novelty.some((t) => Math.abs(t - j) <= hop);
  };
  const maxSections = Math.max(2, Math.ceil(duration / CFG.perSeconds));
  while (segs.length > 1) {
    const sims = segs
      .slice(0, -1)
      .map((a, j) => dot(mean(a), mean(segs[j + 1] ?? [])) - Number(blocked(a, segs[j + 1] ?? [])));
    const short = sims.flatMap((_, j) =>
      length(segs[j] ?? []) < CFG.minLenS || length(segs[j + 1] ?? []) < CFG.minLenS ? [j] : [],
    );
    let j = sims.indexOf(Math.max(...sims));
    if ((sims[j] ?? 0) < CFG.mergeCos && segs.length <= maxSections) {
      if (short.length === 0) break;
      j = short.reduce((best, k) => ((sims[k] ?? 0) > (sims[best] ?? 0) ? k : best), short[0] ?? 0);
    }
    segs.splice(j, 2, [...(segs[j] ?? []), ...(segs[j + 1] ?? [])]);
  }
  return segs;
}

export async function listenSections(
  models: ListenModels,
  mono: Float32Array,
  options: { readonly signal?: AbortSignal } = {},
): AsyncResult<SectionsResult> {
  const duration = mono.length / SR;
  if (duration < 1) return ok({ sections: [], windows: 0, astWindows: 0, novelty: [] });
  if (mono.every((v) => v === 0)) {
    const empty = { genre: [], mood: [], instruments: [], ambience: [], voice: [] };
    const silent = { start: 0, end: roundTo(duration, 2), windows: 0, coherence: 0, ...empty, lufs: null };
    return ok({
      sections: [{ ...silent, silent: true, presence: null, audioSet: null, label: 'digital silence' }],
      windows: 0,
      astWindows: 0,
      novelty: [],
    });
  }
  const win = CFG.winS;
  const hop = Math.max(CFG.hopS, roundTo((duration - win) / Math.max(1, CFG.maxWindows - 1), 2));
  const vocab = await models.text.vocab(options.signal);
  if (!vocab.ok) return vocab;
  const spans = sectionSpans(duration, win, hop);
  const embedded = await models.clap.embedSegments(
    spans.map(([a, b]) => crop(mono, a, b)),
    options.signal,
  );
  if (!embedded.ok) return embedded;
  const rows = embedded.value;
  const novelty = noveltyBounds(mono);
  const times = novelty.map(([t]) => t);
  const segs = mergeWindows(spans, rows, times, duration, win, hop);
  const bounds = [0];
  for (let k = 1; k < segs.length; k++) {
    const aLast = spans[segs[k - 1]?.at(-1) ?? 0] ?? [0, 0];
    const bFirst = spans[segs[k]?.[0] ?? 0] ?? [0, 0];
    const coarse = bFirst[0] < aLast[1] ? (aLast[0] + bFirst[0] + win) / 2 : bFirst[0];
    bounds.push(refineBoundary(mono, coarse, hop));
  }
  bounds.push(roundTo(duration, 2));
  for (let k = 1; k < bounds.length - 1;) {
    if (
      (bounds[k] ?? 0) - (bounds[k - 1] ?? 0) < CFG.minLenS / 2 ||
      (bounds[k + 1] ?? 0) - (bounds[k] ?? 0) < CFG.minLenS / 2
    ) {
      segs.splice(k - 1, 2, [...(segs[k - 1] ?? []), ...(segs[k] ?? [])]);
      bounds.splice(k, 1);
    } else k += 1;
  }
  const drafts: Draft[] = segs.map((seg, k) => {
    const v = meanUnit(seg.map((i) => rows[i] ?? new Float32Array()));
    const tags = sectionTags(v, vocab.value);
    const start = roundTo(bounds[k] ?? 0, 2);
    const end = roundTo(bounds[k + 1] ?? 0, 2);
    const coherence = roundTo(seg.reduce((s, i) => s + dot(rows[i] ?? [], v), 0) / seg.length, 3);
    return {
      start,
      end,
      windows: seg.length,
      coherence,
      genre: tags.music_genre,
      mood: tags.music_mood,
      instruments: tags.instruments,
      ambience: tags.ambience,
      voice: tags.voice,
      ...level(mono, start, end),
      presence: null,
      audioSet: null,
    };
  });
  const astWindows = await sectionAst(models, mono, drafts, CFG.astBudget, options.signal);
  if (!astWindows.ok) return astWindows;
  let sections: ListenSection[] = drafts.map((d) => ({ ...d, label: sectionLabel(d) }));
  for (let k = 1; k < sections.length;) {
    const a = sections[k - 1];
    const b = sections[k];
    if (
      !a ||
      !b ||
      labelKey(a.label) !== labelKey(b.label) ||
      times.some((t) => Math.abs(t - b.start) <= 1)
    ) {
      k += 1;
      continue;
    }
    const keep = a.end - a.start >= b.end - b.start ? a : b;
    const merged = { ...keep, start: a.start, end: b.end, windows: a.windows + b.windows };
    sections = [
      ...sections.slice(0, k - 1),
      { ...merged, ...level(mono, merged.start, merged.end) },
      ...sections.slice(k + 1),
    ];
  }
  return ok({ sections, windows: spans.length, astWindows: astWindows.value, novelty });
}

/** timeline._section_ast: centred 10.24 s crops, one per section (longest first) while `budget` lasts, a second for
 * sections over 15 s if crops are left; each section's Music, Speech, Silence and top labels from their mean. */
async function sectionAst(
  models: ListenModels,
  mono: Float32Array,
  drafts: Draft[],
  budget: number,
  signal?: AbortSignal,
): AsyncResult<number> {
  if (budget <= 0 || drafts.length === 0) return ok(0);
  const labels = await models.ast.labels(signal);
  if (!labels.ok) return labels;
  const span = (d: Draft) => d.end - d.start;
  const order = drafts.map((_, i) => i).sort((a, b) => span(drafts[b] as Draft) - span(drafts[a] as Draft));
  const plan = new Map(order.slice(0, budget).map((k) => [k, 1]));
  for (const k of order) {
    const used = [...plan.values()].reduce((s, n) => s + n, 0);
    if (used < budget && plan.has(k) && span(drafts[k] as Draft) > 15) plan.set(k, 2);
  }
  const crops: Float32Array[] = [];
  const owner: number[] = [];
  for (const [k, n] of [...plan.entries()].sort((a, b) => a[0] - b[0])) {
    const d = drafts[k] as Draft;
    const w = Math.min(span(d), AST_WIN_S);
    for (let j = 0; j < n; j++) {
      const c0 = roundTo(n > 1 ? d.start + ((span(d) - w) * (j + 0.5)) / n : d.start + (span(d) - w) / 2, 3);
      crops.push(crop(mono, c0, roundTo(c0 + w, 3)));
      owner.push(k);
    }
  }
  const probs = await models.ast.probs(crops, { signal });
  if (!probs.ok) return probs;
  for (const k of plan.keys()) {
    const mine = probs.value.filter((_, i) => owner[i] === k).map((r) => r.probs);
    const p = Float32Array.from(
      mine[0] ?? [],
      (_, c) => mine.reduce((s, row) => s + (row[c] ?? 0), 0) / mine.length,
    );
    const of = (label: string) => roundTo(p[labels.value.indexOf(label)] ?? 0, 3);
    drafts[k] = {
      ...(drafts[k] as Draft),
      presence: { music: of('Music'), speech: of('Speech'), silence: of('Silence') },
      audioSet: topLabels(p, labels.value, 5, 0.05).map((e) => ({ label: e.label, score: roundTo(e.p, 3) })),
    };
  }
  return ok(crops.length);
}

const tag = (t: SectionTag): SoundTag => ({
  term: t.term,
  category: t.category,
  cosine: t.cosine,
  z: t.z,
  verdict: null,
  hint: true,
  borderline: false,
});

/** Core's SoundSection (times as milliseconds; every section tag a hint: its z isn't calibrated). */
export function toSoundSection(section: ListenSection): SoundSection {
  return {
    start: msTime(Math.round(section.start * 1000)),
    end: msTime(Math.round(section.end * 1000)),
    label: section.label,
    genre: section.genre.map(tag),
    mood: section.mood.map(tag),
    instruments: section.instruments.map(tag),
    ambience: section.ambience.map(tag),
    voice: section.voice.map(tag),
    presence: section.presence,
    ...(section.audioSet ? { audioSet: [...section.audioSet] } : {}),
    lufs: section.lufs,
    silent: section.silent,
  };
}
