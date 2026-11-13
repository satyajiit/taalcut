// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads one feed file for the manifest check, capped: a hostile feed can't make main buffer more than the file
 * can legitimately be. Only https (and loopback http for a test build's local feed, which feed.ts allows) is
 * fetched, and a redirect must land on the same kind of address.
 */
export type FeedFetch = (url: string) => Promise<Response>;

export type FeedFile =
  | { readonly kind: 'found'; readonly bytes: Uint8Array }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly detail: string };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** https, or loopback http when the feed itself is loopback http (test builds only reach that: feed.ts). */
export function allowedFeedUrl(url: URL, loopbackHttp: boolean): boolean {
  return (
    url.protocol === 'https:' || (loopbackHttp && url.protocol === 'http:' && LOOPBACK.has(url.hostname))
  );
}

/** `<feed>/<name>`, as the update library's generic provider resolves it (the base always ends in a slash). */
export function feedFileUrl(feedUrl: string, name: string): URL {
  return new URL(name, feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`);
}

async function capped(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readFeedFile(
  fetch: FeedFetch,
  url: URL,
  options: { readonly maxBytes: number; readonly loopbackHttp: boolean },
): Promise<FeedFile> {
  if (!allowedFeedUrl(url, options.loopbackHttp))
    return { kind: 'failed', detail: `refused address ${url.protocol}` };
  let response: Response;
  try {
    response = await fetch(url.href);
  } catch (cause) {
    return { kind: 'failed', detail: cause instanceof Error ? cause.message.slice(0, 200) : 'fetch failed' };
  }
  if (response.url && !allowedFeedUrl(new URL(response.url), options.loopbackHttp)) {
    await response.body?.cancel();
    return { kind: 'failed', detail: 'redirected to a refused address' };
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return { kind: 'missing' };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: 'failed', detail: `HTTP ${response.status}` };
  }
  const bytes = await capped(response, options.maxBytes);
  return bytes
    ? { kind: 'found', bytes }
    : { kind: 'failed', detail: `larger than ${options.maxBytes} bytes` };
}
