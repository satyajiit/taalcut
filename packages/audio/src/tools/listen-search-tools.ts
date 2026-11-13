// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lane B's listening tools (EAR1-B1, B2; plan/earshot-round-1.md "Agent tools"): `audio.findMoment` here,
 * `sfx.searchSounds` in sfx-search-tool.ts. Both read only, run locally (the listening runs as an
 * `audio.listen.query` job in the jobs process), time out after 120 s, retry once on a retryable failure, and store
 * an output over 8 KiB as an artifact with a one-line summary.
 */
import { z } from 'zod';
import {
  artifactRefSchema,
  callClock,
  defineTool,
  ok,
  RationalTime,
  rationalTimeJsonSchema,
  timeRangeSchema,
  ulidSchema,
  ULID_PATTERN,
  type AnyTool,
  type ArtifactId,
  type ArtifactStore,
  type AsyncResult,
  type JobRunner,
  type ToolContextBase,
} from '@taalcut/core';
import { FIND_KINDS, type FoundMoments } from '../listen/describe/find';
import { runListenQuery } from '../listen/jobs';
import { findMomentQuery } from '../listen/search/queries';
import { msTime } from '../rates';
import { listenWithin } from './listen-detach';
import { resolveListenSource, type ListenAssetFiles } from './listen-sources';

export const LISTEN_TOOL = {
  timeoutMs: 120_000,
  retry: { maxAttempts: 2, initialDelayMs: 1000 },
  spillBytes: 8192,
  cacheMs: 24 * 3_600_000,
} as const;

export interface ListenSearchToolDeps {
  readonly jobs: Pick<JobRunner, 'run'>;
  readonly assets: ListenAssetFiles;
  /** A folder of Taalcut's own where an artifact is copied for the job; each copy is removed after it. */
  readonly scratch: string;
}

const VERDICTS = ['strong', 'plausible', 'weak', 'no_match'] as const;

export const findMomentInputSchema = z
  .object({
    assetId: ulidSchema('Asset').optional().describe('The library recording to search'),
    artifactId: z
      .string()
      .regex(ULID_PATTERN)
      .optional()
      .describe('Or an audio artifact from an earlier tool'),
    query: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe('The sound in plain words: "a single key press", "rain"'),
    kind: z
      .enum(FIND_KINDS)
      .optional()
      .describe(
        'event: hits, clicks, steps only; texture: stretches of a bed or ambience; auto (default) reads the query',
      ),
    top: z.int().min(1).max(10).optional().describe('Moments to return, best first (default 5)'),
    range: timeRangeSchema.optional().describe('Search only this part of the recording'),
  })
  .refine((input) => (input.assetId === undefined) !== (input.artifactId === undefined), {
    message: 'Give exactly one of assetId and artifactId',
  });

const momentSchema = z.object({
  start: rationalTimeJsonSchema,
  end: rationalTimeJsonSchema,
  kind: z.enum(['stroke', 'event', 'window']),
  z: z.number().describe('Calibrated match; 2 is weak, 2.5 plausible, 3 strong'),
  verdict: z.enum(VERDICTS).nullable().describe('Null for a genre, mood, instrument or voice query: a hint'),
  borderline: z.boolean(),
  headCut: z.boolean().describe('The trim starts inside a sound'),
  tailCut: z.boolean().describe('The trim ends before the sound has decayed'),
});

const findMomentFull = z.object({
  query: z.string(),
  queryKind: z.enum(['event', 'texture', 'either']),
  nearSilent: z.boolean().describe('The recording is near silent: the scores mean nothing'),
  moments: z.array(momentSchema).max(10),
});

export const findMomentOutputSchema = z.union([
  findMomentFull,
  z.object({ artifact: artifactRefSchema, summary: z.string() }),
]);
export type FindMomentOutput = z.output<typeof findMomentOutputSchema>;

/** One line: the best moment and the count, never text from inside the sound. */
export function findMomentLine(found: z.output<typeof findMomentFull>): string {
  const best = found.moments[0];
  if (!best) return `No moment found for "${found.query}".`;
  const at = callClock(RationalTime.toSeconds(best.start));
  const verdict = best.verdict ?? 'hint';
  return `${found.moments.length} moments for "${found.query}"; best at ${at} (z ${best.z}, ${verdict}).`;
}

export function toFindMomentOutput(found: FoundMoments): z.output<typeof findMomentFull> {
  return {
    query: found.query,
    queryKind: found.queryKind,
    nearSilent: found.nearSilent,
    moments: found.moments.map((m) => ({
      start: msTime(m.start * 1000),
      end: msTime(m.end * 1000),
      kind: m.kind,
      z: m.z,
      verdict: m.verdict,
      borderline: m.borderline,
      headCut: m.headCut,
      tailCut: m.tailCut,
    })),
  };
}

/** The output as it is, or stored as an artifact when its JSON is over 8 KiB. */
export async function spillOver<T>(
  output: T,
  line: string,
  artifacts: ArtifactStore,
): AsyncResult<T | { artifact: z.output<typeof artifactRefSchema>; summary: string }> {
  const json = JSON.stringify(output);
  if (Buffer.byteLength(json) <= LISTEN_TOOL.spillBytes) return ok(output);
  const stored = await artifacts.put({ mediaType: 'application/json', data: json, summary: line });
  if (!stored.ok) return stored;
  return ok({ artifact: stored.value, summary: line });
}

const seconds = (t: RationalTime) => RationalTime.toSeconds(t);

function findMomentTool(deps: ListenSearchToolDeps): AnyTool {
  return defineTool({
    name: 'audio.findMoment',
    version: '1.0.0',
    summary: 'Finds the best moments for a described sound inside a long recording, as trims.',
    description:
      'Finds the best moments inside one long recording (a library asset or an audio artifact) for a described ' +
      'sound, e.g. "a single key press" or "rain", with earshot\'s calibrated CLAP match: up to 10 non-overlapping ' +
      'moments, best first, as start and end trims. One-shot queries return hits snapped onto the sound (a trim ' +
      'that cuts into a sound is flagged and ranked lower); continuous ones return plain stretches. Genre and mood ' +
      'queries are hints with no verdict. Output over 8 KiB is stored as an artifact.',
    tags: ['listen', 'search', 'moment', 'clap', 'trim', 'sound'],
    input: findMomentInputSchema,
    output: findMomentOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: LISTEN_TOOL.timeoutMs,
    retry: LISTEN_TOOL.retry,
    cache: { ttlMs: LISTEN_TOOL.cacheMs },
    permission: { network: 'none', filesystem: { read: ['library', 'scratch'], write: ['scratch'] } },
    summarize: (output) => ('summary' in output ? output.summary : findMomentLine(output)),
    describeCall: (_input, output) =>
      'moments' in output && output.moments.length > 0
        ? output.moments
            .slice(0, 3)
            .map((m) => callClock(seconds(m.start)))
            .join(' · ')
        : undefined,
    run: async (input, ctx: ToolContextBase) => {
      const source = await resolveListenSource(
        { assetId: input.assetId, artifactId: input.artifactId as ArtifactId | undefined },
        { assets: deps.assets, artifacts: ctx.artifacts, scratch: deps.scratch },
      );
      if (!source.ok) return source;
      const range = input.range;
      const found = await listenWithin(
        ctx.signal,
        (signal) =>
          runListenQuery(
            deps.jobs,
            findMomentQuery,
            [{ path: source.value.path, name: source.value.name }],
            {
              query: input.query,
              ...(input.kind ? { kind: input.kind } : {}),
              ...(input.top !== undefined ? { top: input.top } : {}),
              ...(range
                ? { start: seconds(range.start), end: seconds(range.start) + seconds(range.duration) }
                : {}),
            },
            { signal },
          ),
        { cleanup: source.value.done },
      );
      if (!found.ok) return found;
      const output = toFindMomentOutput(found.value);
      return spillOver(output, findMomentLine(output), ctx.artifacts);
    },
  });
}

/** `audio.findMoment`, for the `audio` module. */
export function listenSearchTools(deps: ListenSearchToolDeps): AnyTool[] {
  return [findMomentTool(deps)];
}
