// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { CancelledError, err, ok, toTaalcutError, ValidationError, type AsyncResult } from '@taalcut/core';

export interface CreationResource {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly url: string;
}

export function isPublicCreationAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    // Only global unicast; reject mapped and transition forms instead of reparsing ambiguous hex IPv4.
    if (isIP(ip) !== 6) return false;
    const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    return /^[23]/.test(normalized) && !/^(?:2001:(?:db8:|0:|:)|2002:)/.test(normalized);
  }
  const octets = ip.split('.').map(Number);
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  return (
    isIP(ip) === 4 &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}

/** Pin DNS for the actual connection; redirect targets are checked again. No browser cookies are forwarded. */
export async function fetchCreationResource(
  raw: string,
  options: { signal: AbortSignal; maxBytes: number; localOrigin?: string; redirects?: number },
): AsyncResult<CreationResource> {
  try {
    if (options.signal.aborted) return err(CancelledError());
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return err(
        ValidationError({ field: 'url' }, { detail: 'Capture requires an HTTP(S) URL without credentials' }),
      );
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(host, { all: true });
    const local = options.localOrigin === url.origin;
    if (
      !addresses.length ||
      addresses.some(
        (address) =>
          !isPublicCreationAddress(address.address) &&
          !(local && ['127.0.0.1', '::1'].includes(address.address)),
      )
    )
      return err(ValidationError({ field: 'url' }, { detail: 'This address is outside the capture scope' }));
    const address = addresses[0]!;
    const response = await new Promise<{
      status: number;
      location?: string;
      contentType: string;
      bytes: Uint8Array;
    }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          signal: options.signal,
          headers: { 'user-agent': 'Taalcut-Capture/1', 'accept-encoding': 'identity' },
          lookup: (_host, _options, callback) =>
            callback(null, [{ address: address.address, family: address.family }]),
        },
        (reply) => {
          const chunks: Buffer[] = [];
          let total = 0;
          reply.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > options.maxBytes) {
              // Reject before closing: a buffered response can emit end before the socket's error.
              reject(new Error('Capture resource exceeds its byte limit'));
              reply.destroy();
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          reply.on('error', reject);
          reply.once('end', () =>
            resolve({
              status: reply.statusCode ?? 0,
              ...(reply.headers.location ? { location: reply.headers.location } : {}),
              contentType: reply.headers['content-type'] ?? 'application/octet-stream',
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.setTimeout(30_000, () => request.destroy(new Error('Capture request timed out')));
      request.on('error', reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if ((options.redirects ?? 0) >= 5)
        return err(ValidationError({ field: 'url' }, { detail: 'Too many redirects' }));
      return fetchCreationResource(new URL(response.location, url).href, {
        ...options,
        redirects: (options.redirects ?? 0) + 1,
      });
    }
    if (response.status < 200 || response.status >= 300)
      return err(ValidationError({ field: 'url' }, { detail: `Capture returned HTTP ${response.status}` }));
    return ok({ bytes: response.bytes, contentType: response.contentType, url: url.href });
  } catch (cause) {
    return options.signal.aborted ? err(CancelledError()) : err(toTaalcutError(cause));
  }
}
