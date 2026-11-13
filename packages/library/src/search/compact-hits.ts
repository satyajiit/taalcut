// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeps `library.search` and `library.findSimilar` responses under 7,800 UTF-8 bytes (`< 8,192`
 * `DEFAULT_INLINE_OUTPUT_LIMIT`) so a 30-hit search never spills to an artifact or costs an extra
 * `readArtifact` turn, while preserving every hit's `shotId`, `assetId`, `fileName`, `start`,
 * `duration`, `score`, `matchedBy`, and concise `description` inline.
 */
import { MATCH_KINDS, ulidSchema } from '@taalcut/core';
import { z } from 'zod';
import { plainTimeSchema } from './tool-schemas';

export const MAX_INLINE_SEARCH_BYTES = 7_800;

const fromDisk = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'file-system' });
const fromMedia = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'media' });

const hitTimeSchema = z.union([
  plainTimeSchema,
  z.string().describe('Compact RationalTime "value@num/den" when large hit lists are compacted inline'),
]);

export const hitSchema = z.object({
  shotId: ulidSchema('Shot'),
  assetId: ulidSchema('Asset'),
  fileName: fromDisk(z.string()),
  /** Where the shot starts in its file, and how long it is. */
  start: hitTimeSchema,
  duration: hitTimeSchema,
  description: fromMedia(z.string().nullable()).optional(),
  /** What people in the shot are doing ("dancing", "playing music"), fixed words first. */
  actions: z.array(fromMedia(z.string())).optional(),
  /** Where its clip was filmed, in words ("Lisbon, Portugal"; "probably …" from its time zone). Null: unknown. */
  place: z.string().nullable().optional(),
  /** The trip its clip belongs to; a null name is named by place and month. */
  trip: z
    .object({
      id: z.string(),
      name: z.string().nullable().meta({ untrusted: 'user-text' }),
      month: z.string(),
    })
    .nullable()
    .optional(),
  matchedBy: z.array(z.enum(MATCH_KINDS)),
  score: z.number().min(0).max(1),
  /** The matching passage (speech, on-screen text or description), when keywords matched. */
  passage: fromMedia(z.string()).optional(),
});

export const hitsOutput = z.object({
  hits: z.array(hitSchema),
  /** The embedding model isn't installed yet: these are keyword matches only. */
  degraded: z.enum(['keyword-only']).optional(),
});

type HitsOutput = z.input<typeof hitsOutput>;
type Hit = HitsOutput['hits'][number];
type PlainTime = z.output<typeof plainTimeSchema>;
type HitTime = PlainTime | string;

const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

function formatCompactTime(time: HitTime): string {
  if (typeof time === 'string') return time;
  if (time.value === 0) return '0@1/1';
  return `${time.value}@${time.rate.num}/${time.rate.den}`;
}

function secondsOfTime(time: HitTime): number {
  if (typeof time !== 'string') {
    return time.rate.num > 0 ? (time.value * time.rate.den) / time.rate.num : 0;
  }
  const match = /^(-?\d+)@(\d+)\/(\d+)$/.exec(time);
  if (!match) return 0;
  const value = Number(match[1]);
  const num = Number(match[2]);
  const den = Number(match[3]);
  return num > 0 ? (value * den) / num : 0;
}

function truncateText(text: string | null | undefined, maxChars: number): string | null | undefined {
  if (text == null) return text;
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function dropEmptyExtras(hit: Hit): Hit {
  const { actions, place, trip, ...rest } = hit;
  return {
    ...rest,
    ...(actions && actions.length > 0 ? { actions } : {}),
    ...(place != null ? { place } : {}),
    ...(trip != null ? { trip } : {}),
  };
}

export function compactHitsOutput(output: HitsOutput): HitsOutput {
  if (utf8Bytes(output) <= MAX_INLINE_SEARCH_BYTES) return output;

  // Stage 1: shorten snippets (`passage`), then omit them.
  const shortPassage: HitsOutput = {
    ...output,
    hits: output.hits.map((hit) =>
      hit.passage ? { ...hit, passage: truncateText(hit.passage, 96) ?? hit.passage } : hit,
    ),
  };
  if (utf8Bytes(shortPassage) <= MAX_INLINE_SEARCH_BYTES) return shortPassage;

  let current: HitsOutput = {
    ...output,
    hits: output.hits.map(({ passage: _passage, ...rest }) => rest),
  };
  if (utf8Bytes(current) <= MAX_INLINE_SEARCH_BYTES) return current;

  // Stage 2: omit empty `actions` and null `place` / `trip`.
  current = { ...current, hits: current.hits.map(dropEmptyExtras) };
  if (utf8Bytes(current) <= MAX_INLINE_SEARCH_BYTES) return current;

  // Stage 3: progressively truncate `description` and round `score` while keeping object `PlainTime`.
  for (const [descChars, decimals] of [
    [120, 1_000],
    [80, 1_000],
    [52, 1_000],
  ] as const) {
    current = {
      ...current,
      hits: current.hits.map((hit) => ({
        ...hit,
        description: truncateText(hit.description, descChars),
        score: Math.round(hit.score * decimals) / decimals,
      })),
    };
    if (utf8Bytes(current) <= MAX_INLINE_SEARCH_BYTES) return current;
  }

  // Stage 4: for 25–30 hits, encode `start`/`duration` as exact `"value@num/den"` strings and keep concise descriptions.
  for (const [descChars, maxMatched] of [
    [64, 3],
    [48, 2],
    [36, 2],
    [24, 1],
    [14, 1],
  ] as const) {
    current = {
      ...current,
      hits: current.hits.map(({ actions: _a, place: _p, trip: _t, ...hit }) => ({
        ...hit,
        start: formatCompactTime(hit.start),
        duration: formatCompactTime(hit.duration),
        matchedBy: hit.matchedBy.slice(0, maxMatched),
        score: Math.round(hit.score * 100) / 100,
        description: truncateText(hit.description, descChars) ?? null,
      })),
    };
    if (utf8Bytes(current) <= MAX_INLINE_SEARCH_BYTES) return current;
  }

  // Stage 5: emergency fallback if 30 hits have pathologically long filenames (> 80 chars each).
  const hits = [...current.hits];
  for (let i = hits.length - 1; i >= 0 && utf8Bytes({ ...current, hits }) > MAX_INLINE_SEARCH_BYTES; i--) {
    const { description: _desc, ...rest } = hits[i]!;
    hits[i] = rest;
  }
  return { ...current, hits };
}

/** Concise defense-in-depth summary listing top hits (`assetId`, `fileName`, `duration`). */
export function summarizeSearchOutput(output: z.output<typeof hitsOutput>): string {
  if (output.hits.length === 0) return '0 shots found.';
  const top = output.hits.slice(0, 12).map((hit) => {
    const secs = secondsOfTime(hit.duration).toFixed(1);
    return `${hit.assetId} (${hit.fileName}, ${secs}s)`;
  });
  const more = output.hits.length > top.length ? ` (+${output.hits.length - top.length} more)` : '';
  return `${output.hits.length} shots: ${top.join('; ')}${more}`;
}
