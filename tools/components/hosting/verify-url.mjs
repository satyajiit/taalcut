// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks one manifest artifact the way the app downloads it (packages/jobs: Accept-Encoding identity, Range with
 * If-Range to resume): a first-byte range, a last-byte range with If-Range on the ETag, then (unless quick) the
 * whole file streamed through sha256. Size, sha256 and the headers that matter (no Content-Encoding, the
 * Content-Type, an immutable Cache-Control) must all be right.
 */
import { createHash } from 'node:crypto';

const IDENTITY = { 'accept-encoding': 'identity' };

async function rangeProblem(fetch, url, start, end, size, extra = {}) {
  const response = await fetch(url, { headers: { ...IDENTITY, ...extra, range: `bytes=${start}-${end}` } });
  if (response.status !== 206) {
    // A 200 here is the whole file (gigabytes): don't read it.
    await response.body?.cancel();
    return { problem: `range ${start}-${end}: HTTP ${response.status}` };
  }
  const body = Buffer.from(await response.arrayBuffer());
  const expected = `bytes ${start}-${end}/${size}`;
  const got = response.headers.get('content-range');
  if (got !== expected)
    return { problem: `range ${start}-${end}: Content-Range ${got}, expected ${expected}` };
  if (body.length !== end - start + 1) return { problem: `range ${start}-${end}: ${body.length} bytes` };
  return { etag: response.headers.get('etag') ?? undefined };
}

export function headerProblems(headers, { size, contentType, immutable }) {
  const problems = [];
  const length = headers.get('content-length');
  if (length !== String(size)) problems.push(`Content-Length ${length}, expected ${size}`);
  const encoding = headers.get('content-encoding');
  if (encoding && encoding !== 'identity') problems.push(`Content-Encoding ${encoding}`);
  if (contentType && headers.get('content-type') !== contentType)
    problems.push(`Content-Type ${headers.get('content-type')}, expected ${contentType}`);
  if (immutable && !/\bimmutable\b/.test(headers.get('cache-control') ?? ''))
    problems.push(`Cache-Control ${headers.get('cache-control')}, expected immutable`);
  return problems;
}

/** { problems: string[], bytes, sha256? } for { url, size, sha256, contentType }. */
export async function checkArtifact(artifact, { fetch = globalThis.fetch, quick = false } = {}) {
  const { url, size } = artifact;
  const problems = [];
  const first = await rangeProblem(fetch, url, 0, 0, size);
  if (first.problem) problems.push(first.problem);
  if (first.etag) {
    const last = await rangeProblem(fetch, url, size - 1, size - 1, size, { 'if-range': first.etag });
    if (last.problem) problems.push(`with If-Range: ${last.problem}`);
  } else if (!first.problem) problems.push('no ETag, so a download cannot resume safely');
  const expect = { size, contentType: artifact.contentType, immutable: true };
  if (quick) {
    const head = await fetch(url, { method: 'HEAD', headers: IDENTITY });
    if (head.status !== 200) problems.push(`HEAD: HTTP ${head.status}`);
    else problems.push(...headerProblems(head.headers, expect));
    return { problems, bytes: 0 };
  }
  const response = await fetch(url, { headers: IDENTITY });
  if (response.status !== 200 || !response.body) {
    problems.push(`GET: HTTP ${response.status}`);
    return { problems, bytes: 0 };
  }
  problems.push(...headerProblems(response.headers, expect));
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const sha256 = hash.digest('hex');
  if (bytes !== size) problems.push(`${bytes} bytes, expected ${size}`);
  if (sha256 !== artifact.sha256) problems.push(`sha256 ${sha256}, expected ${artifact.sha256}`);
  return { problems, bytes, sha256 };
}

/**
 * The NOTICE.txt the manifest pins ({ url, size, sha256 }) must be served as those bytes, uncompressed, as
 * immutable text, and name the component.
 */
export async function checkNotice(notice, id, { fetch = globalThis.fetch } = {}) {
  const response = await fetch(notice.url, { headers: IDENTITY });
  if (response.status !== 200) return [`notice: HTTP ${response.status}`];
  const body = Buffer.from(await response.arrayBuffer());
  const problems = headerProblems(response.headers, { size: notice.size, immutable: true }).map(
    (p) => `notice: ${p}`,
  );
  if (!/^text\/plain\b/.test(response.headers.get('content-type') ?? ''))
    problems.push(`notice: Content-Type ${response.headers.get('content-type')}`);
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (body.length !== notice.size || sha256 !== notice.sha256)
    problems.push(
      `notice: ${body.length} bytes, sha256 ${sha256}; the manifest pins ${notice.size}, ${notice.sha256}`,
    );
  if (!body.toString('utf8').includes(`Taalcut component "${id}"`))
    problems.push('notice: does not name the component');
  return problems;
}
