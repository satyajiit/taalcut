// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sentry envelope URL and body. https, or loopback http (tests and a local
 * GlitchTip). The node path posts with node:http; Electron uses the SDK.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export interface SentryUrls {
  readonly envelopeUrl: string;
  readonly minidumpUrl: string;
}

/** Undefined when the DSN is missing, not https, or http to something other than loopback. */
export function sentryUrls(dsn: string): SentryUrls | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  if (url.username.length === 0) return undefined;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    return undefined;
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const projectId = parts.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return undefined;
  const prefix = parts.length > 0 ? `/${parts.join('/')}` : '';
  const key = encodeURIComponent(decodeURIComponent(url.username));
  const base = `${url.origin}${prefix}/api/${projectId}`;
  return {
    envelopeUrl: `${base}/envelope/?sentry_key=${key}`,
    minidumpUrl: `${base}/minidump/?sentry_key=${key}`,
  };
}

export function envelopeHeader(eventId: string, sentAt: string, dsn: string): Buffer {
  return Buffer.from(`${JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn })}\n`);
}

/** Item header (with payload byte length) plus payload plus the trailing newline. */
export function envelopeItem(headers: Record<string, unknown>, payload: Buffer): Buffer {
  const head = Buffer.from(`${JSON.stringify({ ...headers, length: payload.length })}\n`);
  return Buffer.concat([head, payload, Buffer.from('\n')]);
}

export function postEnvelope(url: string, body: Buffer): Promise<{ status: number }> {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return Promise.reject(new Error('unsupported envelope url'));
  }
  const options: RequestOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/x-sentry-envelope',
      'content-length': String(body.length),
    },
  };
  return new Promise((resolve, reject) => {
    const req = transport(target, options, (res: IncomingMessage) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
