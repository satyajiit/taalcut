// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared Instagram session wire helpers between main (which owns the keychain
 * vault and the login BrowserWindow) and the agent process (which queries
 * Instagram's Saved Web API and stages ephemeral cookies for yt-dlp).
 */
import {
  callRpc,
  formatInstagramNetscapeCookies,
  INSTAGRAM_PROVIDER,
  ok,
  type AsyncResult,
  type InstagramSessionProvider,
  type InstagramWebSession,
  type MainServicesClient,
} from '@taalcut/core';
import { z } from 'zod';

export const INSTAGRAM_SECRET_KEY = 'instagram-session';

const SAFE_COOKIE_VALUE = /^[^\r\n\t\0;]+$/;

export const storedInstagramSessionSchema = z.object({
  sessionId: z.string().min(1).max(512).regex(SAFE_COOKIE_VALUE),
  csrfToken: z.string().min(1).max(512).regex(SAFE_COOKIE_VALUE),
  dsUserId: z.string().min(1).max(512).regex(SAFE_COOKIE_VALUE),
  username: z.string().min(1).max(120).optional(),
  userAgent: z.string().min(1).max(400).optional(),
  createdAt: z.number().int().nonnegative(),
});
export type StoredInstagramSession = z.output<typeof storedInstagramSessionSchema>;

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').trim();
}

export function toInstagramWebSession(stored: StoredInstagramSession): InstagramWebSession {
  const sessionId = sanitizeHeaderValue(stored.sessionId);
  const csrfToken = sanitizeHeaderValue(stored.csrfToken);
  const dsUserId = sanitizeHeaderValue(stored.dsUserId);
  const cookieHeader = [`sessionid=${sessionId}`, `csrftoken=${csrfToken}`, `ds_user_id=${dsUserId}`].join(
    '; ',
  );
  const userAgent = stored.userAgent ? sanitizeHeaderValue(stored.userAgent) : '';
  const safeUsername = stored.username ? sanitizeHeaderValue(stored.username) : '';
  return {
    username: stored.username ?? null,
    headers: {
      cookie: cookieHeader,
      'x-csrftoken': csrfToken,
      ...(userAgent ? { 'user-agent': userAgent } : {}),
      ...(safeUsername ? { 'x-ig-username': safeUsername } : {}),
    },
    cookiesNetscape: formatInstagramNetscapeCookies({
      sessionId,
      csrfToken,
      dsUserId,
    }),
  };
}

export function createRpcInstagramSessionProvider(
  credentials: Pick<MainServicesClient<'agent'>['credentials'], 'get' | 'invalidate'>,
): InstagramSessionProvider {
  return {
    async getSession(): AsyncResult<InstagramWebSession | null> {
      const answered = await callRpc(credentials.get({ provider: INSTAGRAM_PROVIDER }));
      if (!answered.ok) return answered;
      const wire = answered.value;
      if (!wire || !wire.secret || !wire.headers) return ok(null);
      const username = wire.headers['x-ig-username'] ?? null;
      const { 'x-ig-username': _ignored, ...headers } = wire.headers;
      return ok({
        username,
        headers,
        cookiesNetscape: wire.secret,
      });
    },
    async invalidate(): AsyncResult<void> {
      const invalidated = await callRpc(credentials.invalidate({ provider: INSTAGRAM_PROVIDER }));
      return invalidated.ok ? ok(undefined) : invalidated;
    },
  };
}
