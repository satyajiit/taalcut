// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One batch as a JSON array. node:http, not fetch: fetch adds Accept and
 * User-Agent, and this request may carry only the content type and the app
 * version. No cookie jar. http only after usableTelemetryEndpoint allows it.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { TelemetryEnvelope } from '@taalcut/core';
import { usableTelemetryEndpoint } from './endpoint';

/** The only application header besides Content-Type. */
export const TELEMETRY_VERSION_HEADER = 'X-Taalcut-Version';

const REQUEST_MS = 10_000;

export interface TelemetryTransport {
  /** True only after HTTP 200. False on any failure, including a dropped connection. */
  post(envelopes: readonly TelemetryEnvelope[], signal: AbortSignal): Promise<boolean>;
}

function headerVersion(version: string): string {
  const clean = version.replace(/[^\w.+-]/g, '').slice(0, 64);
  return clean.length > 0 ? clean : '0.0.0';
}

export function createHttpTelemetryTransport(endpoint: string, appVersion: string): TelemetryTransport {
  const version = headerVersion(appVersion);
  return {
    post(envelopes, signal) {
      if (!usableTelemetryEndpoint(endpoint)) return Promise.resolve(false);
      return postJson(endpoint, JSON.stringify(envelopes), version, signal);
    },
  };
}

function postJson(endpoint: string, body: string, version: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    return Promise.resolve(false);
  }
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    let settled = false;
    const handles: {
      timer?: ReturnType<typeof setTimeout>;
      req?: ReturnType<typeof request>;
    } = {};
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (handles.timer) clearTimeout(handles.timer);
      signal.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = (): void => {
      handles.req?.destroy();
      finish(false);
    };
    try {
      handles.req = request(
        target,
        {
          method: 'POST',
          agent: false,
          headers: {
            'Content-Type': 'application/json',
            [TELEMETRY_VERSION_HEADER]: version,
          },
        },
        (res) => {
          res.resume();
          res.on('error', () => finish(false));
          res.on('end', () => finish(res.statusCode === 200));
        },
      );
    } catch {
      resolve(false);
      return;
    }
    const posted = handles.req;
    if (!posted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      posted.destroy();
      finish(false);
    }, REQUEST_MS);
    handles.timer = timer;
    timer.unref();
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    posted.on('error', () => finish(false));
    posted.end(body);
  });
}
