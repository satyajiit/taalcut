// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Public, read-only component downloads. R2 streams the selected range; no file is buffered in Worker memory. */

/** A single inclusive byte range. null means no range; false means unsatisfiable or malformed. */
export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ([first, last].some((n) => n !== null && (!Number.isSafeInteger(n) || n < 0))) return false;
  if (first === null)
    return last === 0 ? false : { offset: Math.max(0, size - last), length: Math.min(size, last) };
  if (first >= size || (last !== null && last < first)) return false;
  const end = last === null ? size - 1 : Math.min(last, size - 1);
  return { offset: first, length: end - first + 1 };
}

function sameEntity(value, object) {
  if (!value) return true;
  if (value.startsWith('"') || value.startsWith('W/')) return value === object.httpEtag;
  const date = Date.parse(value);
  return Number.isFinite(date) && Math.floor(object.uploaded.getTime() / 1000) <= Math.floor(date / 1000);
}

function notModified(request, object) {
  const etags = request.headers.get('if-none-match');
  if (etags)
    return etags
      .split(',')
      .some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === object.httpEtag);
  const since = request.headers.get('if-modified-since');
  return since !== null && sameEntity(since, object);
}

function objectHeaders(object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('last-modified', object.uploaded.toUTCString());
  headers.set('accept-ranges', 'bytes');
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'link',
    '<https://components.taalcut.app/download-gateway/2026-11-11/source/download-gateway-source.tar.zst>; rel="source"',
  );
  // The previous public R2 domain sends no CORS grant, including for Origin: https://taalcut.app.
  // Keep that boundary: the desktop's main-process downloader needs no cross-origin browser access.
  return headers;
}

export async function download(request, bucket) {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const key = new URL(request.url).pathname.slice(1);
  if (!key || key.split('/').some((part) => !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(part) || part === '..'))
    return new Response('Not found', { status: 404 });
  const object = await bucket.head(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = objectHeaders(object);
  if (notModified(request, object)) return new Response(null, { status: 304, headers });
  headers.set('content-length', String(object.size));
  if (request.method === 'HEAD') return new Response(null, { headers });
  const requested = sameEntity(request.headers.get('if-range'), object) ? request.headers.get('range') : null;
  const range = byteRange(requested, object.size);
  if (range === false) {
    headers.set('content-range', `bytes */${object.size}`);
    headers.set('content-length', '0');
    headers.set('cache-control', 'no-store');
    return new Response(null, { status: 416, headers });
  }
  const result = await bucket.get(key, {
    onlyIf: { etagMatches: object.etag },
    ...(range ? { range } : {}),
  });
  if (!result) return new Response('Not found', { status: 404 });
  // Uploads never replace keys, but fail closed if metadata and the streamed body somehow describe different bytes.
  if (!('body' in result)) return new Response('Object changed; retry download', { status: 412 });
  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    headers.set('content-length', String(range.length));
  }
  return new Response(result.body, { status: range ? 206 : 200, headers });
}

export default {
  fetch: (request, env) => download(request, env.COMPONENTS),
};
