// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lane A's listening tools (EAR1-A3; plan/earshot-round-1.md "Agent tools"): `audio.listen` and `audio.compare`
 * here, `audio.critique` in critique-tool.ts. Each reads only, runs locally (the listening is an
 * `audio.listen.analyse` or `audio.listen.query` job in the jobs process), times out after 120 s, retries once on a
 * retryable failure and stores an output over 8 KiB as an artifact with a one-line summary. Results are cached by
 * the jobs process's listen analysis cache, whose key is the sound's content hash, the model builds (their dtype)
 * and the listen config's version, so a model or config change is never answered from an older result; the tool
 * layer's own cache (tool, version, input) can't see the models, so it is off. Genre, mood, instrument and voice
 * tags are hints (`hint: true`, no verdict). EAR1-G1: `audio.compare` also holds a sound against a template's
 * reference reel (`{ templateId }`, the reel the template keeps; the desktop injects `templateReel`).
 */
import { z } from 'zod';
import {
  audioSetLabelSchema,
  defineTool,
  ok,
  soundTagSchema,
  type AnyTool,
  type AsyncResult,
  type ToolContextBase,
} from '@taalcut/core';
import { abQuery, type AbQueryResult } from '../listen/describe/ab-query';
import { compareQuery, matchQuery, rankQuery, type ListenSourceRef } from '../listen/analysis/queries';
import { runListenAnalyse, runListenQuery } from '../listen/jobs';
import { listenWithin } from './listen-detach';
import { LISTEN_TOOL, spillOver } from './listen-search-tools';
import {
  compareSourceSchema,
  listenSourceSchema,
  realnessJsonSchema,
  realnessOut,
  resolveAll,
  spilledSchema,
  type ListenQaToolDeps,
  type ListenSourceInput,
} from './listen-tool-sources';

const tagSchema = soundTagSchema;

const soundSchema = z.object({
  name: z.string(),
  tags: z.array(tagSchema).max(6).describe('Validated tags, best first'),
  hints: z.array(tagSchema).max(4).describe('Genre, mood, instrument, voice: hints, never facts'),
  audioSet: z.array(audioSetLabelSchema).max(3),
  lufs: z.number().nullable(),
  truePeakDbtp: z.number(),
  bpm: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  realness: realnessJsonSchema.nullable(),
  sections: z.number().int().nonnegative().describe('Sections the sound changes between'),
  events: z.number().int().nonnegative().describe('Hits and swells heard'),
  nearSilent: z.boolean(),
});

const listenFull = z.object({
  sounds: z.array(soundSchema).max(20).optional(),
  ranking: z
    .object({
      query: z.string(),
      results: z.array(
        z.object({
          name: z.string(),
          z: z.number(),
          verdict: z.enum(['strong', 'plausible', 'weak', 'no_match']).nullable(),
          soundsMostLike: z.string(),
        }),
      ),
    })
    .optional(),
});
// The spilled shape first: listenFull's keys are all optional, so it would accept a spilled output as `{}`.
export const listenOutputSchema = z.union([spilledSchema, listenFull]);

export const listenInputSchema = z.object({
  sources: z.array(listenSourceSchema).min(1).max(20).describe('Up to 20 library sounds or audio artifacts'),
  query: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .optional()
    .describe('A description to match (one sound) or rank them by (several): "a deep cinematic impact"'),
});

function listenLine(out: z.output<typeof listenFull>): string {
  if (out.ranking) {
    const best = out.ranking.results[0];
    return best
      ? `Ranked ${out.ranking.results.length} for "${out.ranking.query}": best ${best.name} (z ${best.z}, ${best.verdict ?? 'hint'}).`
      : `Nothing ranked for "${out.ranking.query}".`;
  }
  const first = out.sounds?.[0];
  const tag = first?.tags[0] ?? first?.hints[0];
  return first
    ? `${out.sounds?.length} sound(s) heard; ${first.name}: ${tag ? `${tag.term} (${tag.verdict ?? 'hint'})` : 'nothing stands out'}.`
    : 'Nothing heard.';
}

function listenTool(deps: ListenQaToolDeps): AnyTool {
  return defineTool({
    name: 'audio.listen',
    version: '1.0.0',
    summary: 'Hears what kind of sound or music it is: genre and mood (hints), tags, tempo, key, loudness.',
    description:
      "Hears up to 20 library sounds, music tracks or audio artifacts with earshot's calibrated CLAP and AST: what " +
      'kind of sound or music each is (validated tags with a verdict: strong, plausible, weak), its genre, mood, ' +
      'instruments and voice as hints (never a verdict), AudioSet labels, loudness and true peak, tempo and key, ' +
      'its sections and hits, and realness (a real recording or code-made). With `query`, one sound is matched to ' +
      'the description and several are ranked by it. Output over 8 KiB is stored as an artifact.',
    tags: ['listen', 'hear', 'kind', 'music', 'genre', 'mood', 'song', 'sound', 'describe', 'audioset'],
    input: listenInputSchema,
    output: listenOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: LISTEN_TOOL.timeoutMs,
    retry: LISTEN_TOOL.retry,
    cache: false,
    permission: { network: 'none', filesystem: { read: ['library', 'scratch'], write: ['scratch'] } },
    summarize: (output) => ('summary' in output ? output.summary : listenLine(output)),
    run: async (input, ctx: ToolContextBase) => {
      const resolved = await resolveAll(input.sources as readonly ListenSourceInput[], deps, ctx.artifacts);
      if (!resolved.ok) return resolved;
      const { refs, done } = resolved.value;
      const out = await listenWithin(ctx.signal, (signal) => hear(deps, refs, input.query, signal), {
        cleanup: done,
      });
      return out.ok ? spillOver(out.value, listenLine(out.value), ctx.artifacts) : out;
    },
  });
}

type ListenOut = z.output<typeof listenFull>;

/** `audio.listen`'s work in the jobs process: a ranking by `query` of several sounds, or each sound heard. */
async function hear(
  deps: ListenQaToolDeps,
  refs: readonly ListenSourceRef[],
  query: string | undefined,
  signal: AbortSignal,
): AsyncResult<ListenOut> {
  const opts = { signal };
  if (query && refs.length > 1) {
    const ranked = await runListenQuery(deps.jobs, rankQuery, refs, { query }, opts);
    if (!ranked.ok) return ranked;
    return ok({
      ranking: {
        query: ranked.value.query,
        results: ranked.value.results.map((r) => ({
          name: refs[r.index]?.name ?? `sound ${r.index + 1}`,
          z: r.z,
          verdict: r.verdict,
          soundsMostLike: r.soundsMostLike.term,
        })),
      },
    });
  }
  const sounds: z.output<typeof soundSchema>[] = [];
  for (const ref of refs) {
    const want = {
      measures: true,
      events: true,
      sections: true,
      key: true,
      tempo: true,
      realness: true,
      tags: true,
    };
    const heard = await runListenAnalyse(
      deps.jobs,
      { path: ref.path, ...(ref.range ? { range: ref.range } : {}), want },
      opts,
    );
    if (!heard.ok) return heard;
    const a = heard.value;
    let tags = a.tags?.tags ?? [];
    if (query) {
      const matched = await runListenQuery(deps.jobs, matchQuery, [ref], { queries: [query] }, opts);
      if (!matched.ok) return matched;
      const q = matched.value[0]?.results[0];
      // The query as asked, scored as a tag (a hint category's query keeps no verdict).
      if (q) {
        const asked = {
          term: q.query,
          category: q.category,
          cosine: q.cosine,
          z: q.z,
          verdict: q.verdict,
          hint: q.hint,
          borderline: q.borderline,
        };
        tags = [asked, ...tags];
      }
    }
    sounds.push({
      name: ref.name ?? 'sound',
      tags: tags.slice(0, 6),
      hints: (a.tags?.hints ?? []).slice(0, 4),
      audioSet: (a.tags?.audioSet ?? []).slice(0, 3),
      lufs: a.measures?.lufs ?? null,
      truePeakDbtp: a.measures?.truePeakDbtp ?? -240,
      ...(a.measures?.tempo !== undefined ? { bpm: a.measures.tempo?.bpm ?? null } : {}),
      ...(a.measures?.key !== undefined
        ? { key: a.measures.key ? `${a.measures.key.tonic} ${a.measures.key.mode}` : null }
        : {}),
      realness: realnessOut(a.realness),
      sections: a.sections.length,
      events: a.events.length,
      nearSilent: a.measures?.nearSilent ?? false,
    });
  }
  return ok({ sounds });
}

export const compareInputSchema = z
  .object({
    a: compareSourceSchema.describe('The sound to judge (e.g. the current version)'),
    b: compareSourceSchema
      .optional()
      .describe('A second sound (or the template’s reel): A/B, and how B differs from A in measured terms'),
    refs: z
      .array(compareSourceSchema)
      .min(2)
      .max(20)
      .optional()
      .describe('Reference sounds to hold A against'),
    query: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe('With b: which of the two is closer to this'),
    k: z.int().min(1).max(20).optional().describe('Nearest references to list (default 5)'),
  })
  .refine((input) => input.b !== undefined || (input.refs?.length ?? 0) >= 2, {
    message: 'Give b, or at least 2 refs',
  });

const compareFull = z.object({
  ab: z
    .object({
      cosine: z.number(),
      likeness: z.string(),
      closerToQuery: z.enum(['a', 'b']).nullable().optional(),
      closerToRefs: z.enum(['a', 'b']).nullable().optional(),
      differences: z.array(z.string()).describe('How B differs from A, most important first'),
      words: z.string(),
    })
    .optional(),
  nearest: z.array(z.object({ name: z.string(), cosine: z.number() })).optional(),
  typicality: z.object({ z: z.number(), fit: z.string() }).optional(),
});
// The spilled shape first: compareFull's keys are all optional (as listenOutputSchema's).
export const compareOutputSchema = z.union([spilledSchema, compareFull]);

function compareLine(out: z.output<typeof compareFull>): string {
  if (out.ab) {
    const diff = out.ab.differences.length ? `; B differs in ${out.ab.differences.join(', ')}` : '';
    return `A and B: ${out.ab.likeness} (cosine ${out.ab.cosine})${diff}.`;
  }
  const best = out.nearest?.[0];
  return `Nearest reference ${best ? `${best.name} (cosine ${best.cosine})` : 'none'}; ${out.typicality?.fit ?? ''}.`;
}

type CompareOut = z.output<typeof compareFull>;

function abOutput(r: AbQueryResult): CompareOut {
  return {
    ab: {
      cosine: r.cosineAb,
      likeness: r.likeness,
      ...(r.query ? { closerToQuery: r.query.closer } : {}),
      ...(r.refs ? { closerToRefs: r.refs.closer } : {}),
      differences: r.differences ? [...r.differences.keys] : [],
      words: r.differences?.words ?? '',
    },
  };
}

function compareTool(deps: ListenQaToolDeps): AnyTool {
  return defineTool({
    name: 'audio.compare',
    version: '1.0.0',
    summary:
      'Compares a sound with another or with references: how alike, which is closer, differences in words.',
    description:
      'Compares sound A with sound B (A/B: CLAP likeness, which is closer to a description or to references, and ' +
      'how B differs from A in measured terms such as louder, brighter, a sharper attack, in words) or with at ' +
      'least 2 reference sounds (the nearest references and whether A fits the set). Sounds are library assets, ' +
      "audio artifacts or a template's reference reel ({ templateId }: hold A against the reel it copies), " +
      'optionally trimmed. Output over 8 KiB is stored as an artifact.',
    tags: ['listen', 'compare', 'ab', 'difference', 'reference', 'clap'],
    input: compareInputSchema,
    output: compareOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: LISTEN_TOOL.timeoutMs,
    retry: LISTEN_TOOL.retry,
    cache: false,
    permission: { network: 'none', filesystem: { read: ['library', 'scratch'], write: ['scratch'] } },
    summarize: (output) => ('summary' in output ? output.summary : compareLine(output)),
    run: async (input, ctx: ToolContextBase) => {
      const all = [input.a, ...(input.b ? [input.b] : []), ...(input.refs ?? [])] as ListenSourceInput[];
      const resolved = await resolveAll(all, deps, ctx.artifacts);
      if (!resolved.ok) return resolved;
      const { refs, done } = resolved.value;
      const params = {
        ...(input.query ? { query: input.query } : {}),
        ...(input.k !== undefined ? { k: input.k } : {}),
      };
      const out = await listenWithin(
        ctx.signal,
        async (signal): AsyncResult<CompareOut> => {
          if (input.b) {
            const ab = await runListenQuery(deps.jobs, abQuery, refs, params, { signal });
            return ab.ok ? ok(abOutput(ab.value)) : ab;
          }
          const compared = await runListenQuery(deps.jobs, compareQuery, refs, params, { signal });
          if (!compared.ok) return compared;
          return ok({
            nearest: compared.value.nearest.map((n) => ({
              name: refs[n.index + 1]?.name ?? `reference ${n.index + 1}`,
              cosine: n.cosine,
            })),
            typicality: { z: compared.value.typicality.z, fit: compared.value.typicality.fit },
          });
        },
        { cleanup: done },
      );
      return out.ok ? spillOver(out.value, compareLine(out.value), ctx.artifacts) : out;
    },
  });
}

/** `audio.listen` and `audio.compare` (and, critique-tool.ts, `audio.critique`) for the `audio` module. */
export function listenTools(deps: ListenQaToolDeps): AnyTool[] {
  return [listenTool(deps), compareTool(deps)];
}
