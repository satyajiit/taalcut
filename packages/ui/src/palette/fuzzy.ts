// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: palette search · system: DESIGN.md v0.2 · states: n/a (pure function) */

/**
 * Fuzzy matching for the command palette (DESIGN.md v0.2: ⌘K finds what you
 * mean). Matches come in tiers, and a better tier always wins:
 *
 * 1. the query as written, in one piece ("theme" in "Use the dark theme");
 * 2. each query word starting a word, in order ("dark th");
 * 3. runs that each start a word, like initials ("gtl" for "Go to Library");
 * 4. letters in order anywhere (still found, ranked last).
 *
 * Only contiguous runs are highlighted, never scattered single letters.
 * Case- and accent-insensitive.
 */

export interface FuzzyMatch {
  readonly score: number;
  /** Indices in the text to highlight: whole runs only. */
  readonly indices: readonly number[];
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase();

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_./:(“"‘']/.test(text[i - 1] ?? '');
const isWordEnd = (text: string, i: number) => i >= text.length || /[\s\-_./:)”"’',…]/.test(text[i] ?? '');

const range = (from: number, length: number) => Array.from({ length }, (_, i) => from + i);

/** Tier 1: the whole query in one piece; the best placement is at a word start. */
function contiguous(q: string, text: string): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
    let score = 300;
    if (isWordStart(text, at)) score += 30;
    if (isWordEnd(text, at + q.length)) score += 10;
    if (at === 0) score += 10;
    if (!best || score > best.score) best = { score, indices: range(at, q.length) };
  }
  return best;
}

/** Tier 2: every query word starts a word of the text, in order. */
function wordPrefixes(words: readonly string[], text: string): FuzzyMatch | null {
  if (words.length < 2) return null;
  const indices: number[] = [];
  let from = 0;
  for (const word of words) {
    let at = text.indexOf(word, from);
    while (at !== -1 && !isWordStart(text, at)) at = text.indexOf(word, at + 1);
    if (at === -1) return null;
    indices.push(...range(at, word.length));
    from = at + word.length;
  }
  return { score: 200 + (indices[0] === 0 ? 10 : 0), indices };
}

/**
 * Tiers 3 and 4: the query split into runs, placed in order. Each run is
 * placed at the next word start that holds it when there is one (tier 3 if
 * every run manages it), else at its next position. Longer runs score more.
 */
function runs(q: string, text: string): FuzzyMatch | null {
  const indices: number[] = [];
  const runLengths: number[] = [];
  let atWordStarts = true;
  let from = 0;
  let i = 0;
  while (i < q.length) {
    // The longest piece of the rest of the query that starts a word from here on.
    let placed = false;
    for (let length = q.length - i; length >= 1 && !placed; length--) {
      const piece = q.slice(i, i + length);
      for (let at = text.indexOf(piece, from); at !== -1; at = text.indexOf(piece, at + 1)) {
        if (!isWordStart(text, at)) continue;
        indices.push(...range(at, length));
        runLengths.push(length);
        from = at + length;
        i += length;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    const at = text.indexOf(q[i] ?? '', from);
    if (at === -1) return null;
    atWordStarts = false;
    // Joins the previous run when it follows it directly.
    const last = runLengths.length - 1;
    if (indices.at(-1) === at - 1 && last >= 0) runLengths[last] = (runLengths[last] ?? 0) + 1;
    else runLengths.push(1);
    indices.push(at);
    from = at + 1;
    i += 1;
  }
  // Capped below the next tier, so a long query can't climb out of its tier.
  const score =
    Math.min(
      99,
      runLengths.reduce((sum, length) => sum + length * length, 0),
    ) + (atWordStarts ? 100 : 0);
  // Highlight runs only. Initials count when every run starts a word ("gtl"); in a scattered
  // match a letter on its own isn't shown as a match.
  const shown = atWordStarts
    ? indices
    : indices.filter((at, k) => indices[k - 1] === at - 1 || indices[k + 1] === at + 1);
  return { score, indices: shown };
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { score: 0, indices: [] };
  const folded = fold(text);
  const match =
    contiguous(words.join(' '), folded) ?? wordPrefixes(words, folded) ?? runs(words.join(''), folded);
  if (!match) return null;
  // Shorter texts win ties: "Library" beats "Library settings" for "lib".
  return { score: match.score - folded.length / 100, indices: match.indices };
}

export interface Searchable {
  readonly title: string;
  readonly keywords?: readonly string[];
  readonly group?: string;
}

/**
 * The items that match, best first, by tier (see fuzzyMatch); within a tier
 * the title beats a keyword or the group. The original order breaks ties, so
 * an empty query keeps it.
 */
export function fuzzyRank<T extends Searchable>(
  items: readonly T[],
  query: string,
): { item: T; match: FuzzyMatch | null }[] {
  if (query.trim() === '') return items.map((item) => ({ item, match: null }));
  const ranked: { item: T; match: FuzzyMatch | null; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const title = fuzzyMatch(query, item.title);
    // A keyword or group counts a little less than the title in the same tier,
    // so "theme" finds the theme items before a title that merely holds t-h-e-m-e.
    const others = [...(item.keywords ?? []), ...(item.group ? [item.group] : [])]
      .map((text) => fuzzyMatch(query, text))
      .filter((m): m is FuzzyMatch => m !== null);
    const other = others.length > 0 ? Math.max(...others.map((m) => m.score)) - 5 : -Infinity;
    if (title && title.score >= other) ranked.push({ item, match: title, score: title.score, index });
    else if (title || others.length > 0)
      ranked.push({ item, match: title, score: Math.max(other, title?.score ?? -Infinity), index });
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, match }) => ({ item, match }));
}
