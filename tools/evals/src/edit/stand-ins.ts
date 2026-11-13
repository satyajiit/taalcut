// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the tools the Editor names that live outside the timeline and render packages, as small stand-ins over
 * the eval's footage: library.search and library.getAsset (the library's need its database), and
 * templates.styleProfile (withheld from a request, so never offered; registered because the skill names it). Their
 * names, descriptions, summaries and tags are the real tools', so tool search ranks them as it does in the app. The
 * comments family is the library's own tools over an in-memory store: the eval's video has no comments.
 */
import {
  ConflictError,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  ulidSchema,
  type CommentFilter,
  type CommentStore,
  type TimelineComment,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { ALL_SHOTS, MEDIA_FRAMES, type Shot } from './footage';

const LOCAL = { network: 'none' } as const;
const time = z.object({ seconds: z.number() });

const hit = (entry: Shot, score: number) => ({
  shotId: entry.shotId,
  assetId: entry.assetId,
  fileName: entry.fileName,
  start: { seconds: 0 },
  duration: { seconds: MEDIA_FRAMES / 30 },
  description: entry.description,
  score: Math.round(score * 1000) / 1000,
});

/** Words of the query found in the shot's description and tags, as a share of the query's words. */
function scoreOf(entry: Shot, query: string): number {
  const words = query.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return 0;
  const haystack = `${entry.description} ${entry.tags.join(' ')}`.toLowerCase();
  return words.filter((word) => haystack.includes(word.replace(/s$/, ''))).length / words.length;
}

export function libraryStandIn(): ToolModule {
  const search = defineTool({
    name: 'library.search',
    version: '1.1.0',
    description:
      "Searches the user's footage by meaning and keywords, in any of the app's languages: what is seen " +
      '(the frames), the descriptions, what is said and on-screen text. Returns shots with their file, ' +
      'start and length, why each matched, and a 0..1 score for ordering.',
    summary: "Finds shots in the user's footage by meaning and keywords.",
    tags: ['search', 'footage', 'shots', 'find'],
    input: z.object({
      query: z.string().trim().min(1).max(500).describe('What to look for, e.g. "sunset shots on the beach"'),
      limit: z.int().min(1).max(30).default(12),
    }),
    output: z.object({
      hits: z.array(
        z.object({
          shotId: ulidSchema('Shot'),
          assetId: ulidSchema('Asset'),
          fileName: z.string(),
          start: time,
          duration: time,
          description: z.string(),
          score: z.number(),
        }),
      ),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    run: async (input) =>
      ok({
        hits: ALL_SHOTS.map((entry) => ({ entry, score: scoreOf(entry, input.query) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, input.limit)
          .map((row) => hit(row.entry, row.score)),
      }),
  });
  const getAsset = defineTool({
    name: 'library.getAsset',
    version: '1.1.0',
    description:
      "One file's profile: kind, length, size, orientation, language, quality and index state; with " +
      '`include`, its shots (descriptions, objects, place, shot type, motion, quality, on-screen text, ' +
      'speech), its transcript (long ones are stored as an artifact) and where its copies are.',
    summary: "One file's profile: facts, shots, transcript and copies.",
    tags: ['asset', 'profile', 'transcript', 'shots'],
    input: z.object({ assetId: ulidSchema('Asset') }),
    output: z.object({
      assetId: ulidSchema('Asset'),
      kind: z.literal('video'),
      fileName: z.string(),
      seconds: z.number(),
      shots: z.array(z.object({ shotId: ulidSchema('Shot'), description: z.string() })),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    run: async (input) => {
      const found = ALL_SHOTS.find((entry) => entry.assetId === input.assetId);
      if (!found) return err(NotFoundError({ entity: 'asset', id: input.assetId }));
      return ok({
        assetId: found.assetId,
        kind: 'video' as const,
        fileName: found.fileName,
        seconds: MEDIA_FRAMES / 30,
        shots: [{ shotId: found.shotId, description: found.description }],
      });
    },
  });
  return defineToolModule({ id: 'library', tools: [search, getAsset] });
}

export function templatesStandIn(): ToolModule {
  const styleProfile = defineTool({
    name: 'templates.styleProfile',
    version: '1.0.0',
    description: "The project's style set: how the user's references are made (only the make flow's finish reads it).",
    summary: "The project's style set.",
    tags: ['style', 'profile'],
    input: z.object({ projectId: ulidSchema('Project') }),
    output: z.object({ state: z.literal('none') }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    run: async () => ok({ state: 'none' as const }),
  });
  return defineToolModule({ id: 'templates', tools: [styleProfile] });
}

/** The comment store the library's comments tools read, in memory (cmt's family; the Editor names it). */
export function memoryCommentStore(): CommentStore {
  const comments = new Map<string, TimelineComment>();
  const matches = (comment: TimelineComment, filter: CommentFilter = {}) =>
    (filter.statuses === undefined || filter.statuses.includes(comment.status)) &&
    (filter.ids === undefined || filter.ids.includes(comment.id));
  const missing = (id: string) => err(NotFoundError({ entity: 'comment', id }));
  return {
    async create(comment) {
      if (comments.has(comment.id)) return err(ConflictError({ entity: 'comment', id: comment.id }));
      comments.set(comment.id, comment);
      return ok(comment);
    },
    async put(comment) {
      if (!comments.has(comment.id)) return missing(comment.id);
      comments.set(comment.id, comment);
      return ok(comment);
    },
    async get(commentId) {
      const found = comments.get(commentId);
      return found ? ok(found) : missing(commentId);
    },
    async list(timelineId, filter) {
      return ok([...comments.values()].filter((comment) => comment.timelineId === timelineId && matches(comment, filter)));
    },
    async count(timelineId) {
      return ok([...comments.values()].filter((comment) => comment.timelineId === timelineId).length);
    },
    async listByProject(projectId, filter) {
      return ok([...comments.values()].filter((comment) => comment.projectId === projectId && matches(comment, filter)));
    },
    async remove(commentId) {
      return comments.delete(commentId) ? ok(undefined) : missing(commentId);
    },
  };
}
