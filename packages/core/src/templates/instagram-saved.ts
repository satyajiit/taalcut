// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved on Instagram: collections and saved Reels metadata cached in the local
 * library, plus commands to watch a collection, sync it on demand, or link a
 * saved Reel to a broken-down Template.
 *
 * Authentication lives in main's keychain vault under `INSTAGRAM_PROVIDER`;
 * only non-secret status, collection metadata and public Reel URLs cross IPC
 * to the renderer or the SQLite library.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { idSchema, type TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { SignInWarning } from '../settings/accounts-contract';

export const INSTAGRAM_PROVIDER = 'instagram' as const;
export const ALL_SAVED_COLLECTION_ID = 'all_saved' as const;

export const INSTAGRAM_COLLECTION_ID_REGEX = /^[A-Za-z0-9_.-]{1,120}$/;
export const INSTAGRAM_SHORTCODE_REGEX = /^[A-Za-z0-9_-]{1,80}$/;

export const INSTAGRAM_WARNING: SignInWarning = {
  feature: 'instagram.saved',
  termsVersion: '2026-10-26',
  titleKey: 'templates.warning.instagram.title',
  bodyKey: 'templates.warning.instagram.body',
  riskKey: 'templates.warning.instagram.risk',
};

export const instagramAuthRequiredError = defineError('templates.instagram_auth_required', {
  retryable: false,
});
export const instagramSessionExpiredError = defineError('templates.instagram_session_expired', {
  retryable: false,
});
export const instagramRateLimitedError = defineError('templates.instagram_rate_limited', {
  retryable: true,
});
export const instagramFetchFailedError = defineError('templates.instagram_fetch_failed', {
  retryable: true,
});
export const instagramCollectionNotFoundError = defineError('templates.instagram_collection_not_found', {
  retryable: false,
});

const safeCollectionIdSchema = z.string().trim().min(1).max(120).regex(INSTAGRAM_COLLECTION_ID_REGEX);
const safeShortcodeSchema = z.string().trim().min(1).max(80).regex(INSTAGRAM_SHORTCODE_REGEX);

export const instagramCollectionSchema = z.object({
  id: safeCollectionIdSchema,
  name: z.string().min(1).max(200),
  mediaCount: z.int().nonnegative(),
  coverUrl: z.url().nullable(),
  watched: z.boolean(),
  autoBreakdown: z.boolean(),
  lastSyncedAt: z.int().nonnegative().nullable(),
  updatedAt: z.int().nonnegative(),
});
export type InstagramCollection = z.output<typeof instagramCollectionSchema>;

export const instagramSavedReelSchema = z.object({
  shortcode: safeShortcodeSchema,
  mediaPk: z.string().min(1).max(80),
  collectionId: safeCollectionIdSchema,
  permalink: z.url(),
  caption: z.string().max(4000).nullable(),
  authorHandle: z.string().max(120).nullable(),
  durationMs: z.int().nonnegative().nullable(),
  thumbnailUrl: z.url().nullable(),
  savedAt: z.int().nonnegative(),
  templateId: idSchema<'Template'>().nullable(),
});
export type InstagramSavedReel = z.output<typeof instagramSavedReelSchema>;

export const instagramSavedStatusSchema = z.object({
  signedIn: z.boolean(),
  username: z.string().min(1).max(120).nullable(),
  warning: z.object({
    feature: z.string().min(1),
    termsVersion: z.string().min(1),
    titleKey: z.string(),
    bodyKey: z.string(),
    riskKey: z.string(),
  }),
  acknowledgedAt: z.int().nonnegative().nullable(),
  watchedCollections: z.int().nonnegative(),
  lastSyncedAt: z.int().nonnegative().nullable(),
});
export type InstagramSavedStatus = z.output<typeof instagramSavedStatusSchema>;

export const instagramReelsQuerySchema = z.object({
  collectionId: safeCollectionIdSchema.optional(),
  query: z.string().trim().max(200).optional(),
  onlyUnlinked: z.boolean().default(false),
  limit: z.int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type InstagramReelsQuery = z.output<typeof instagramReelsQuerySchema>;

export const instagramReelsPageSchema = z.object({
  items: z.array(instagramSavedReelSchema),
  nextCursor: z.string().nullable(),
});
export type InstagramReelsPage = z.output<typeof instagramReelsPageSchema>;

export const instagramSyncResultSchema = z.object({
  collections: z.array(instagramCollectionSchema),
  syncedReels: z.int().nonnegative(),
  addedReels: z.int().nonnegative(),
  queuedBreakdowns: z.int().nonnegative(),
});
export type InstagramSyncResult = z.output<typeof instagramSyncResultSchema>;

export const INSTAGRAM_SAVED_COMMANDS = {
  setWatch: 'instagramSaved.setWatch',
  syncCollection: 'instagramSaved.syncCollection',
  linkTemplate: 'instagramSaved.linkTemplate',
} as const;

const app = { projectId: z.null().default(null) };

export const instagramSavedCommandPayloads = {
  [INSTAGRAM_SAVED_COMMANDS.setWatch]: z.object({
    ...app,
    collectionId: safeCollectionIdSchema,
    watched: z.boolean(),
    autoBreakdown: z.boolean().default(false),
  }),
  [INSTAGRAM_SAVED_COMMANDS.syncCollection]: z.object({
    ...app,
    collectionId: safeCollectionIdSchema.optional(),
  }),
  [INSTAGRAM_SAVED_COMMANDS.linkTemplate]: z.object({
    ...app,
    shortcode: safeShortcodeSchema,
    templateId: idSchema<'Template'>().nullable(),
  }),
};

export interface InstagramCollectionUpsert {
  readonly id: string;
  readonly name: string;
  readonly mediaCount: number;
  readonly coverUrl: string | null;
  readonly lastSyncedAt?: number | null;
}

export interface InstagramSavedReelUpsert {
  readonly shortcode: string;
  readonly mediaPk: string;
  readonly collectionId: string;
  readonly permalink: string;
  readonly caption: string | null;
  readonly authorHandle: string | null;
  readonly durationMs: number | null;
  readonly thumbnailUrl: string | null;
  readonly savedAt: number;
}

export interface InstagramSavedStore {
  listCollections(): AsyncResult<InstagramCollection[]>;
  getCollection(collectionId: string): AsyncResult<InstagramCollection | null>;
  upsertCollections(
    items: readonly InstagramCollectionUpsert[],
    context?: CommandContext,
  ): AsyncResult<InstagramCollection[]>;
  setWatch(
    input: { readonly collectionId: string; readonly watched: boolean; readonly autoBreakdown: boolean },
    context?: CommandContext,
  ): AsyncResult<InstagramCollection>;
  listReels(query: InstagramReelsQuery): AsyncResult<InstagramReelsPage>;
  upsertReels(
    items: readonly InstagramSavedReelUpsert[],
    context?: CommandContext,
  ): AsyncResult<{ readonly addedShortcodes: string[] }>;
  linkTemplate(
    shortcode: string,
    templateId: TemplateId | null,
    context?: CommandContext,
  ): AsyncResult<{ readonly previousTemplateId: TemplateId | null }>;
  clear?(context?: CommandContext): AsyncResult<void>;
}

export const InstagramSavedStoreToken = createToken<InstagramSavedStore>('core.instagramSavedStore');

export interface InstagramWebSession {
  readonly username: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookiesNetscape: string;
}

export interface InstagramSessionProvider {
  getSession(): AsyncResult<InstagramWebSession | null>;
  invalidate(): AsyncResult<void>;
}

export const InstagramSessionProviderToken = createToken<InstagramSessionProvider>(
  'core.instagramSessionProvider',
);

const cleanCookiePart = (value: string) => value.replace(/[\r\n\t\0;]/g, '');

/** Formats an Instagram browser cookie set as a Netscape HTTP Cookie File for yt-dlp. */
export function formatInstagramNetscapeCookies(cookies: {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly dsUserId: string;
}): string {
  const expires = Math.floor(Date.now() / 1000) + 90 * 86_400;
  const rows = [
    ['.instagram.com', 'TRUE', '/', 'TRUE', String(expires), 'sessionid', cleanCookiePart(cookies.sessionId)],
    ['.instagram.com', 'TRUE', '/', 'TRUE', String(expires), 'csrftoken', cleanCookiePart(cookies.csrfToken)],
    ['.instagram.com', 'TRUE', '/', 'TRUE', String(expires), 'ds_user_id', cleanCookiePart(cookies.dsUserId)],
  ];
  return ['# Netscape HTTP Cookie File', ...rows.map((row) => row.join('\t')), ''].join('\n');
}

/** Extracts the shortcode from an Instagram Reel/post URL, or returns null. */
export function extractInstagramShortcode(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== 'instagram.com' && parsed.hostname !== 'www.instagram.com') return null;
    const match = /^\/(?:reel|reels|p)\/([A-Za-z0-9_-]{1,80})(?:\/|$)/.exec(parsed.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
