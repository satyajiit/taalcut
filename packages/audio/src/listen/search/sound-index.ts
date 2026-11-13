// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text-to-sound search over sounds whose CLAP embeddings are already known (the SFX bank's shipped rows, cached
 * embeddings of pack and library sounds): earshot's `rank` without the audio model. A sound's calibration against
 * the vocabulary (u_t = a·E_t − E_t·m, its mean and population std) doesn't depend on the query, so it is computed
 * once per vocabulary and kept; a query is then one text embedding and one dot product per sound:
 *   z = (a·q − q·m − mean) / std.
 * Near-silent sounds rank last (verdict `no_match`); a hint query (genre, mood, instrument, voice) gets no verdict.
 *
 * **Names.** A sound with a name (a bank title, a pack title, a file name) is also matched by it: the query's CLAP
 * text cosine to the name, standardised over the sounds searched (`nameScore`). Sounds are ranked by z + nameScore,
 * the two weighted equally; the verdict stays the audio's. On the listen-pick golden set the audio alone puts the
 * right family in the top 5 for 60 % of requests, audio and names for 90 % (fp16; SPEC "EAR1 sound search").
 */
import { ok, type AsyncResult, type ListenVerdict, type SoundTagCategory } from '@taalcut/core';
import { isBorderline, roundTo, verdictFor } from '../calibrate/verdict';
import { dot, type ListenVocab } from '../calibrate/vocab';
import { LISTEN_CONFIG } from '../config';
import type { ListenModels } from '../describe/context';

const { stdEpsilon, skip, unvalidated } = LISTEN_CONFIG.calibration;

export interface IndexedSound {
  readonly id: string;
  /** The unit CLAP audio embedding (`vocab.embed_file`'s pooled one). */
  readonly embedding: Float32Array;
  readonly nearSilent?: boolean;
  /** Its name's CLAP text embedding (template-averaged, as a query's). */
  readonly name?: Float32Array;
}

interface Calibrated {
  readonly u: Float64Array;
  readonly mean: number;
  readonly std: number;
  /** Its best vocabulary term (quality and production left out). */
  readonly best: number;
}

export interface TermHint {
  readonly term: string;
  readonly z: number;
}

export interface SoundHit {
  readonly id: string;
  /** The entry's position in the index. */
  readonly index: number;
  readonly z: number;
  readonly cosine: number;
  readonly verdict: ListenVerdict | null;
  readonly borderline: boolean;
  readonly nearSilent: boolean;
  /** The name's cosine to the query, standardised over the sounds searched; null without a name. */
  readonly nameScore: number | null;
  /** What it was ranked by: z + nameScore. */
  readonly rankScore: number;
  /** Its best vocabulary description and that term's z. */
  readonly soundsLike: { readonly term: string; readonly category: SoundTagCategory; readonly z: number };
  /** The best terms of each asked hint category (genre, mood …): hints, never verdicts. */
  readonly hints?: Partial<Record<SoundTagCategory, readonly TermHint[]>>;
}

export interface SoundSearch {
  readonly query: string;
  /** The nearest vocabulary term's category: what kind of description the query is. */
  readonly category: SoundTagCategory;
  readonly hint: boolean;
  readonly hits: readonly SoundHit[];
}

export interface ScoreOptions {
  readonly filter?: (entry: IndexedSound) => boolean;
  /** Return the best `hintsPer` terms of these categories per sound. */
  readonly hints?: readonly SoundTagCategory[];
  readonly hintsPer?: number;
  /** D23: tags (hints too) are read against the fp16-built vocabulary; default the query's. */
  readonly hintVocab?: ListenVocab;
}

export interface SoundIndex {
  readonly entries: readonly IndexedSound[];
  /** Every entry against one embedded query, best first (near-silent last). */
  score(query: Float32Array, vocab: ListenVocab, options?: ScoreOptions): SoundHit[];
}

function calibrateEntry(entry: IndexedSound, vocab: ListenVocab, skipped: readonly boolean[]): Calibrated {
  const n = vocab.rows.length;
  const u = new Float64Array(n);
  let sum = 0;
  for (let t = 0; t < n; t++) {
    u[t] = dot(entry.embedding, vocab.rows[t] ?? []) - (vocab.bias[t] ?? 0);
    sum += u[t] ?? 0;
  }
  const mean = sum / n;
  let sq = 0;
  for (let t = 0; t < n; t++) sq += ((u[t] ?? 0) - mean) ** 2;
  let best = -1;
  for (let t = 0; t < n; t++) if (!skipped[t] && (best < 0 || (u[t] ?? 0) > (u[best] ?? 0))) best = t;
  return { u, mean, std: Math.sqrt(sq / n) + stdEpsilon, best };
}

function hintsOf(
  s: Calibrated,
  vocab: ListenVocab,
  categories: readonly SoundTagCategory[],
  per: number,
): Partial<Record<SoundTagCategory, TermHint[]>> {
  const out: Partial<Record<SoundTagCategory, TermHint[]>> = {};
  for (const category of categories) {
    const terms: TermHint[] = [];
    vocab.categories.forEach((c, t) => {
      if (c === category) terms.push({ term: vocab.terms[t] ?? '', z: ((s.u[t] ?? 0) - s.mean) / s.std });
    });
    out[category] = terms
      .sort((a, b) => b.z - a.z)
      .slice(0, per)
      .map((h) => ({ term: h.term, z: roundTo(h.z, 2) }));
  }
  return out;
}

/** The names' cosines to the query, standardised over the given entries (population std). */
function nameScores(entries: readonly IndexedSound[], query: Float32Array): Map<IndexedSound, number> {
  const named = entries.filter((e) => e.name);
  const cos = named.map((e) => dot(query, e.name ?? []));
  const mean = cos.reduce((a, b) => a + b, 0) / Math.max(1, cos.length);
  const sd = Math.sqrt(cos.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, cos.length)) || 1;
  return new Map(named.map((e, i) => [e, ((cos[i] ?? mean) - mean) / sd]));
}

export function createSoundIndex(entries: readonly IndexedSound[]): SoundIndex {
  const calibrated = new WeakMap<ListenVocab, Calibrated[]>();

  function calibrationFor(vocab: ListenVocab): Calibrated[] {
    const known = calibrated.get(vocab);
    if (known) return known;
    const skipped = vocab.categories.map((c) => (skip as readonly string[]).includes(c));
    const rows = entries.map((entry) => calibrateEntry(entry, vocab, skipped));
    calibrated.set(vocab, rows);
    return rows;
  }

  return {
    entries,
    score(query, vocab, options = {}) {
      const stats = calibrationFor(vocab);
      const hintVocab = options.hintVocab ?? vocab;
      const hintStats = options.hints?.length ? calibrationFor(hintVocab) : undefined;
      const bias = vocab.biasOf(query);
      const category = vocab.nearestCategory(query);
      const chosen = options.filter ? entries.filter(options.filter) : entries;
      const names = nameScores(chosen, query);
      const hits: SoundHit[] = [];
      entries.forEach((entry, index) => {
        if (options.filter && !options.filter(entry)) return;
        const s = stats[index] as Calibrated;
        const cosine = dot(entry.embedding, query);
        const z = roundTo((cosine - bias - s.mean) / s.std, 2);
        const nearSilent = entry.nearSilent ?? false;
        const verdict = nearSilent ? 'no_match' : verdictFor(z, category);
        const name = names.get(entry);
        hits.push({
          id: entry.id,
          index,
          z,
          cosine: roundTo(cosine, 3),
          verdict,
          borderline: verdict !== null && !nearSilent && isBorderline(z),
          nearSilent,
          nameScore: name === undefined ? null : roundTo(name, 2),
          rankScore: roundTo(z + (name ?? 0), 2),
          soundsLike: {
            term: vocab.terms[s.best] ?? '',
            category: vocab.categories[s.best] ?? 'everyday',
            z: roundTo(((s.u[s.best] ?? 0) - s.mean) / s.std, 2),
          },
          ...(hintStats && options.hints
            ? {
                hints: hintsOf(
                  hintStats[index] as Calibrated,
                  hintVocab,
                  options.hints,
                  options.hintsPer ?? 3,
                ),
              }
            : {}),
        });
      });
      return hits.sort(
        (a, b) =>
          Number(a.nearSilent) - Number(b.nearSilent) || b.rankScore - a.rankScore || a.index - b.index,
      );
    },
  };
}

export interface SearchIndexOptions extends ScoreOptions {
  readonly top?: number;
  readonly signal?: AbortSignal;
}

/** One free-text query over the index: the text model (or its bank) for the query, nothing else. */
export async function searchSoundIndex(
  models: Pick<ListenModels, 'text'>,
  index: SoundIndex,
  query: string,
  options: SearchIndexOptions = {},
): AsyncResult<SoundSearch> {
  const texts = await models.text.queries([query], options.signal);
  if (!texts.ok) return texts;
  const q = texts.value.queries[0]?.embedding ?? new Float32Array();
  const vocab = texts.value.vocab;
  const hits = index.score(q, vocab, options);
  const category = vocab.nearestCategory(q);
  return ok({
    query,
    category,
    hint: (unvalidated as readonly string[]).includes(category),
    hits: options.top === undefined ? hits : hits.slice(0, options.top),
  });
}

/** Names as the queries are embedded (the vocabulary's templates, free-text path), in order. */
export async function embedNames(
  models: Pick<ListenModels, 'text'>,
  names: readonly string[],
  signal?: AbortSignal,
): AsyncResult<Float32Array[]> {
  if (names.length === 0) return ok([]);
  const embedded = await models.text.queries(names, signal);
  if (!embedded.ok) return embedded;
  return ok(embedded.value.queries.map((q) => q.embedding));
}
