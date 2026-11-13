// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HTTP side of a resumable download: which headers to send for an offset,
 * and what a response means for the part on disk. Pure; download.ts acts on it.
 */
import { err, ok, type Result, type TaalcutError } from '@taalcut/core';
import { DownloadFailed, DownloadRejected, SizeMismatch } from './errors';
import { contentLength, isRetryableStatus, parseContentRange } from './http';
import { isAllowedRedirectUrl } from './manifest';
import { ifRangeValue, validatorsChanged, type PartMeta } from './resume-state';
import { parseRetryAfter } from './retry';

/** Redirects followed for one request before the mirror counts as broken. */
export const MAX_REDIRECTS = 5;

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Where the redirect `response` (to a request for `from`, after `hops`
 * redirects) leads, checked before anything connects there. A rejection moves
 * on to the next mirror. The detail leaves the Location out: CDN redirects
 * carry signed tokens.
 */
export function followRedirect(
  response: Response,
  from: string,
  hops: number,
  component: string,
): Result<string> {
  const reject = (detail: string) =>
    err(DownloadRejected({ component, status: response.status }, { detail }));
  if (hops >= MAX_REDIRECTS) return reject(`more than ${MAX_REDIRECTS} redirects`);
  const location = response.headers.get('location');
  if (!location) return reject(`HTTP ${response.status} without a Location`);
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return reject('redirected to a URL that does not parse');
  }
  return isAllowedRedirectUrl(next.href) ? ok(next.href) : reject('redirected to a URL that is not https');
}

export interface RequestState {
  /** The mirror: what the part's validators belong to. */
  readonly url: string;
  /** The URL the response is for, after redirects. Default `url`. */
  readonly fetchedUrl?: string;
  /** Bytes already on disk and in the hash. */
  readonly offset: number;
  readonly meta: PartMeta | undefined;
  readonly label: string;
  readonly size: number;
}

export type Verdict =
  /** This mirror cannot serve the file: try the next one. */
  | { kind: 'reject'; error: TaalcutError }
  /** Worth another try on the same mirror after a backoff. */
  | { kind: 'retry'; error: TaalcutError; retryAfterMs?: number }
  /** The bytes on disk don't belong to what the server has now: discard them and ask again. */
  | { kind: 'restart'; error: TaalcutError; immediate: boolean }
  /** Write the body. `fromZero` when the server sent the whole file. */
  | { kind: 'accept'; fromZero: boolean; etag?: string; lastModified?: string };

export function requestHeaders(state: RequestState): Record<string, string> {
  // Identity, so byte offsets mean the same thing on both sides.
  const headers: Record<string, string> = { 'accept-encoding': 'identity' };
  if (state.offset > 0) {
    headers.range = `bytes=${state.offset}-`;
    // Validators belong to one server; a different mirror is checked by the final sha256 instead.
    const ifRange = state.meta?.url === state.url ? ifRangeValue(state.meta) : undefined;
    if (ifRange) headers['if-range'] = ifRange;
  }
  return headers;
}

export function classifyResponse(response: Response, state: RequestState): Verdict {
  const component = state.label;
  const { status, headers } = response;
  const landing = landingProblem(response.url, state.fetchedUrl ?? state.url);
  if (landing) return { kind: 'reject', error: DownloadRejected({ component, status }, { detail: landing }) };
  if (status === 416) {
    // Our offset is past the server's end: the remote file shrank or changed.
    return {
      kind: 'restart',
      error: DownloadFailed({ component }, { detail: 'HTTP 416' }),
      immediate: false,
    };
  }
  if (status !== 200 && status !== 206) {
    const detail = `HTTP ${status} from ${state.url}`;
    if (!isRetryableStatus(status)) {
      return { kind: 'reject', error: DownloadRejected({ component, status }, { detail }) };
    }
    const retryAfterMs = parseRetryAfter(headers.get('retry-after'));
    return { kind: 'retry', error: DownloadFailed({ component }, { detail }), retryAfterMs };
  }
  const range = parseContentRange(headers.get('content-range'));
  const advertised = status === 206 ? range?.total : contentLength(headers);
  if (advertised !== undefined && advertised !== state.size) {
    const params = { component, expectedBytes: state.size, actualBytes: advertised };
    return { kind: 'reject', error: SizeMismatch(params, { detail: state.url }) };
  }
  const etag = headers.get('etag') ?? undefined;
  const lastModified = headers.get('last-modified') ?? undefined;
  if (status === 206) {
    const changed = state.meta?.url === state.url && validatorsChanged(state.meta, etag, lastModified);
    if (!range || range.start !== state.offset || changed) {
      // The server resumed something other than our part (it ignored If-Range, or got the offset wrong).
      const detail = changed ? 'remote file changed' : `unexpected Content-Range from ${state.url}`;
      return { kind: 'restart', error: DownloadFailed({ component }, { detail }), immediate: changed };
    }
  }
  // A 200 to a range request means no range support, or If-Range said the file changed.
  return { kind: 'accept', fromZero: status === 200, etag, lastModified };
}

/**
 * Why the body can't be taken as coming from `requested`, or undefined. The
 * response must say where it came from; a fetch that followed a redirect on
 * its own must have ended somewhere a redirect may lead.
 */
function landingProblem(responseUrl: string, requested: string): string | undefined {
  if (!responseUrl) return 'the response does not say which URL it came from';
  if (sameUrl(responseUrl, requested)) return undefined;
  return isAllowedRedirectUrl(responseUrl) ? undefined : 'redirected to a URL that is not https';
}

function sameUrl(a: string, b: string): boolean {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    x.hash = y.hash = '';
    return x.href === y.href;
  } catch {
    return false;
  }
}
