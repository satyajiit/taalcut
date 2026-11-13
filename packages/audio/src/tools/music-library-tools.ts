// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music pack's tools (SPEC P3.9): `music.findLibraryTrack` searches the bundled CC0 tracks and
 * `music.useLibraryTrack` adds one to the library and chooses it as the timeline's music through
 * `music.choosePath` (path b, so the cuts re-sync to it). Plain tools, not a module: the `music` module id is
 * shared with render's `music.choosePath`, and the composition root offers them as one module.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ConflictError,
  defineTool,
  err,
  MUSIC_COMMANDS,
  NO_TOOL_RETRY,
  ok,
  parseId,
  RationalTime,
  ulidSchema,
  type AnyTool,
  type AsyncResult,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { ListenUnavailable } from '../listen/errors';
import { describeTracks, type DescribedTrack, type MusicDescribeDeps } from '../music/library-describe';
import { moodWordSchema } from '../music/library-catalogue';
import { MILLISECONDS } from '../rates';
import { listenWithin } from './listen-detach';
import type { LibraryQuery, MusicLibrary } from '../music/library-service';

export interface MusicLibraryToolDeps {
  readonly library: MusicLibrary;
  readonly readTimeline: (timelineId: TimelineId, signal: AbortSignal) => AsyncResult<Timeline>;
  /** EAR1-B3: listening for `describe`; absent, a `describe` search fails with audio.listen_unavailable. */
  readonly describe?: MusicDescribeDeps;
}

export const findLibraryTrackInputSchema = z.object({
  bpm: z
    .number()
    .min(40)
    .max(240)
    .optional()
    .describe("The timeline's tempo; tracks within 6 % (or half or double) match"),
  mood: z.array(moodWordSchema).max(6).optional().describe('Lowercase mood words, e.g. "upbeat", "calm"'),
  minSeconds: z.number().positive().max(1200).optional().describe('The shortest track that will do'),
  describe: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'What it should sound like, e.g. "calm lo-fi with soft piano": ranks the pack and the user\'s library music by listening',
    ),
});

export const findLibraryTrackOutputSchema = z.object({
  tracks: z
    .array(
      z.object({
        trackId: z.string(),
        title: z.string(),
        bpm: z.number().nullable(),
        seconds: z.number().nullable(),
        licence: z.literal('CC0-1.0').optional(),
        attribution: z.string().optional(),
        /** EAR1-B3, with `describe`: */
        source: z.enum(['pack', 'library']).optional(),
        assetId: z
          .string()
          .optional()
          .describe("A library track: the user's own; choose it with music.choosePath"),
        match: z
          .object({
            z: z.number().describe('Calibrated match to the description; 2 weak, 2.5 plausible, 3 strong'),
            verdict: z.enum(['strong', 'plausible', 'weak', 'no_match']).nullable(),
            borderline: z.boolean(),
          })
          .optional(),
        hints: z
          .object({ genre: z.array(z.string()).max(3), mood: z.array(z.string()).max(3) })
          .optional()
          .describe('What it may be: hints, not facts'),
      }),
    )
    .max(10),
});

export const useLibraryTrackInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  trackId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .describe('From music.findLibraryTrack'),
  revision: z.int().positive().optional().describe('The timeline revision you read; a stale one is refused'),
});

export const useLibraryTrackOutputSchema = z.object({
  path: z.literal('ownTrack'),
  assetId: ulidSchema('Asset'),
  trackId: z.string(),
  title: z.string(),
  licence: z.literal('CC0-1.0'),
  sourceUrl: z.string(),
});

const keyOf = (input: z.output<typeof useLibraryTrackInputSchema>) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        MUSIC_COMMANDS.choosePath,
        'library',
        input.projectId,
        input.timelineId,
        input.trackId,
        input.revision ?? null,
      ]),
    )
    .digest('hex');

function describedRow(row: DescribedTrack) {
  const match = { z: row.z, verdict: row.verdict, borderline: row.borderline };
  const hints = { genre: [...row.hints.genre], mood: [...row.hints.mood] };
  if (row.track)
    return {
      trackId: row.track.id,
      title: row.track.title,
      bpm: row.track.bpm,
      seconds: row.track.seconds,
      licence: row.track.licence,
      ...(row.track.attribution ? { attribution: row.track.attribution } : {}),
      source: 'pack' as const,
      match,
      hints,
    };
  const music = row.music;
  return {
    trackId: music?.assetId ?? '',
    title: music?.title ?? '',
    bpm: music?.bpm ?? null,
    seconds: music?.seconds ?? null,
    source: 'library' as const,
    assetId: music?.assetId ?? '',
    match,
    hints,
  };
}

async function describeSearch(
  deps: MusicLibraryToolDeps,
  query: LibraryQuery,
  describe: string,
  signal: AbortSignal,
) {
  if (!deps.describe) return err(ListenUnavailable({ reason: 'no_listening' }));
  const candidates = await deps.library.candidates(query);
  const libraryRes = deps.describe.library ? await deps.describe.library(signal) : undefined;
  const library = libraryRes?.ok ? libraryRes.value : [];
  if (!candidates.ok && library.length === 0) return candidates;
  const described = await describeTracks(
    {
      searcher: deps.describe.searcher,
      ...(libraryRes ? { library: async () => libraryRes } : {}),
    },
    candidates.ok ? candidates.value : [],
    query,
    describe,
    signal,
  );
  if (!described.ok) return described;
  return ok({ tracks: described.value.map(describedRow) });
}

function findLibraryTrackTool(deps: MusicLibraryToolDeps) {
  return defineTool({
    name: 'music.findLibraryTrack',
    version: '1.1.0',
    summary:
      'Searches the music pack (CC0) by tempo, mood and length; describe ranks it and your music by sound.',
    description:
      'Searches the Taalcut music pack, a small set of CC0 tracks bundled with the app, by tempo (within 6 %, or ' +
      'half or double), mood words and minimum length. Returns at most 10 tracks, best first; an empty list means ' +
      'nothing matched. Fails with audio.music_library_empty while the pack has no tracks. With `describe` it also ' +
      "searches the user's library music and ranks every track by how it sounds (a calibrated CLAP match), each " +
      'with genre and mood hints: hints, not facts.',
    tags: ['music', 'library', 'cc0', 'tempo', 'mood', 'listen'],
    input: findLibraryTrackInputSchema,
    output: findLibraryTrackOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 120_000,
    retry: { maxAttempts: 2, initialDelayMs: 500 },
    // EAR1-R2: no tool-layer cache. Its key (tool, version, input) can't see the library's music or the model
    // build; the embeddings are cached below it (the derived cache), and the pack search is a filter.
    cache: false,
    permission: { network: 'none', filesystem: { read: ['app-data', 'library'] } },
    run: async (input, ctx) => {
      const query: LibraryQuery = {
        ...(input.bpm !== undefined ? { bpm: input.bpm } : {}),
        ...(input.mood ? { moods: input.mood } : {}),
        ...(input.minSeconds !== undefined ? { minSeconds: input.minSeconds } : {}),
      };
      const describe = input.describe;
      // EAR1-R2: a first describe may download the listening models; past 100 s it goes on in the background.
      if (describe !== undefined)
        return listenWithin(ctx.signal, (signal) => describeSearch(deps, query, describe, signal));
      const found = await deps.library.find(query);
      if (!found.ok) return found;
      return ok({
        tracks: found.value.map((track) => ({
          trackId: track.id,
          title: track.title,
          bpm: track.bpm,
          seconds: track.seconds,
          licence: track.licence,
          ...(track.attribution ? { attribution: track.attribution } : {}),
        })),
      });
    },
  });
}

function useLibraryTrackTool(deps: MusicLibraryToolDeps) {
  return defineTool({
    name: 'music.useLibraryTrack',
    version: '1.0.0',
    summary: "Uses a Taalcut music pack track as the timeline's music; the cuts re-sync to its beats.",
    description:
      "Adds a Taalcut music pack track (CC0) to the library and chooses it as the timeline's music, as the " +
      "user's own track: the cuts re-sync to its beats. Take trackId from music.findLibraryTrack. Undoable.",
    tags: ['music', 'library', 'cc0', 'beats'],
    input: useLibraryTrackInputSchema,
    output: useLibraryTrackOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: MUSIC_COMMANDS.choosePath,
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none', filesystem: { read: ['app-data'], write: ['library'] } },
    idempotencyKey: keyOf,
    run: async (input, ctx) => {
      const timeline = await deps.readTimeline(input.timelineId, ctx.signal);
      if (!timeline.ok) return timeline;
      if (input.revision !== undefined && timeline.value.revision !== input.revision)
        return err(
          ConflictError(
            { entity: 'timeline', id: input.timelineId },
            { detail: `the timeline is at revision ${timeline.value.revision}, not ${input.revision}` },
          ),
        );
      const directAsset = parseId<'Asset'>(input.trackId.toUpperCase());
      if (directAsset.ok) {
        const directAssetId = directAsset.value;
        const done = await ctx.dispatch({
          projectId: input.projectId,
          timelineId: input.timelineId,
          choice: {
            path: 'ownTrack',
            assetId: directAssetId,
            offset: RationalTime.of(0, MILLISECONDS),
            gainDb: 0,
          },
        });
        if (!done.ok) return done;
        return ok({
          path: 'ownTrack' as const,
          assetId: directAssetId,
          trackId: input.trackId,
          title: directAssetId,
          licence: 'CC0-1.0' as const,
          sourceUrl: 'taalcut://library/asset',
        });
      }
      const used = await deps.library.use({
        timeline: timeline.value,
        trackId: input.trackId,
        signal: ctx.signal,
      });
      if (!used.ok) return used;
      const done = await ctx.dispatch(used.value.payload);
      if (!done.ok) return done;
      return ok({
        path: 'ownTrack' as const,
        assetId: used.value.assetId,
        trackId: used.value.track.id,
        title: used.value.track.title,
        licence: used.value.track.licence,
        sourceUrl: used.value.track.sourceUrl,
      });
    },
  });
}

/** The music pack's two tools, for the composition root's `music` module. */
export function musicLibraryTools(deps: MusicLibraryToolDeps): AnyTool[] {
  return [findLibraryTrackTool(deps), useLibraryTrackTool(deps)];
}
