// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type HubErrorCode, type HubProblem } from '@taalcut/core/hub';

import { type JsonBody } from './read-body';
import { dedupeProblems } from './json';

/** JSON with no CORS headers. The app calls from the agent process, never from a page. */
export function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export function invalid(problems: readonly HubProblem[]): Response {
  return json({ code: 'hub.invalid', problems: dedupeProblems(problems) }, 400);
}

/** A body readJsonBody refused: 413 over the size cap, 400 when it isn't UTF-8 JSON. */
export function unreadable(body: JsonBody & { ok: false }): Response {
  return body.reason === 'too-large'
    ? json({ code: 'hub.invalid', problems: [{ path: '', rule: 'tooLarge' }] }, 413)
    : invalid([{ path: '', rule: 'schema' }]);
}

export function fail(
  code: HubErrorCode,
  status: number,
  extra?: { retryAfterSeconds?: number; params?: Record<string, string | number | boolean> },
): Response {
  return json({ code, ...extra }, status);
}

/** Every GitHub failure reads the same to the app: retryable, try later. */
export function githubUnavailable(): Response {
  return fail('hub.github_unavailable', 503);
}
