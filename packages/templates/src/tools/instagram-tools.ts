// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Read-only agent tools for browsing the user's cached Instagram Saved
 * Collections and Saved Reels so the Analyst or Librarian can pick a saved
 * Reel URL and pass it to `templates.fetchReference`.
 */
import {
  defineTool,
  err,
  instagramAuthRequiredError,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import type { TemplateToolDeps } from './deps';

const MINUTE = 60_000;
const referenceText = z.string().meta({ untrusted: 'reference' });

export const listInstagramCollectionsInputSchema = z.object({});
export const listInstagramCollectionsOutputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: referenceText,
      mediaCount: z.int().nonnegative(),
      watched: z.boolean(),
      autoBreakdown: z.boolean(),
      lastSyncedAt: z.int().nonnegative().nullable(),
    }),
  ),
});

export const listInstagramSavedReelsInputSchema = z.object({
  collectionId: z.string().max(120).optional(),
  query: z.string().max(200).optional(),
  onlyUnlinked: z.boolean().optional(),
  limit: z.int().min(1).max(50).optional(),
});
export const listInstagramSavedReelsOutputSchema = z.object({
  items: z.array(
    z.object({
      shortcode: z.string(),
      collectionId: z.string(),
      permalink: z.string(),
      caption: referenceText.nullable(),
      authorHandle: referenceText.nullable(),
      durationMs: z.int().nonnegative().nullable(),
      savedAt: z.int().nonnegative(),
      templateId: ulidSchema('Template').nullable(),
    }),
  ),
});

export function listInstagramCollectionsTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.listInstagramCollections',
    version: '1.0.0',
    summary: "Lists the user's synced Instagram Saved collections.",
    description:
      "Lists the user's synced Instagram Saved collections (including 'all_saved') with their Reel counts " +
      'and watch status. Use templates.listInstagramSavedReels with a collectionId to pick a saved Reel.',
    tags: ['instagram', 'saved', 'collections', 'inspiration', 'reels'],
    input: listInstagramCollectionsInputSchema,
    output: listInstagramCollectionsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] } },
    run: async () => {
      if (!deps.service.instagramCollections) return err(instagramAuthRequiredError());
      const listed = await deps.service.instagramCollections();
      if (!listed.ok) return listed;
      return ok({
        items: listed.value.map((col) => ({
          id: col.id,
          name: col.name,
          mediaCount: col.mediaCount,
          watched: col.watched,
          autoBreakdown: col.autoBreakdown,
          lastSyncedAt: col.lastSyncedAt,
        })),
      });
    },
  });
}

export function listInstagramSavedReelsTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.listInstagramSavedReels',
    version: '1.0.0',
    summary: "Finds Reels in the user's synced Instagram Saved collections.",
    description:
      "Finds Reels in the user's synced Instagram Saved collections by collectionId, search query " +
      '(caption or author handle), or onlyUnlinked (Reels not yet turned into a template). Returns ' +
      'each Reel permalink so it can be broken down with templates.fetchReference.',
    tags: ['instagram', 'saved', 'reels', 'inspiration', 'reference'],
    input: listInstagramSavedReelsInputSchema,
    output: listInstagramSavedReelsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] } },
    run: async (input) => {
      if (!deps.service.instagramReels) return err(instagramAuthRequiredError());
      const page = await deps.service.instagramReels({
        ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}),
        ...(input.query !== undefined ? { query: input.query } : {}),
        onlyUnlinked: input.onlyUnlinked ?? false,
        limit: input.limit ?? 20,
      });
      if (!page.ok) return page;
      return ok({
        items: page.value.items.map((reel) => ({
          shortcode: reel.shortcode,
          collectionId: reel.collectionId,
          permalink: reel.permalink,
          caption: reel.caption,
          authorHandle: reel.authorHandle,
          durationMs: reel.durationMs,
          savedAt: reel.savedAt,
          templateId: reel.templateId,
        })),
      });
    },
  });
}
