// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One release object into the bucket. Skipped when the key already holds the same bytes (its x-amz-meta-sha256
 * and size); refused when it holds other bytes, because a hosted key never changes, a NOTICE.txt included (the
 * manifest pins its sha256). Large files go up in parts (the 2.6 GB Qwen weights), each part's sha256 signed.
 * Checked after upload with a HEAD: size, sha256, Content-Type and Cache-Control as sent.
 */
import { open } from 'node:fs/promises';

export const PART_SIZE = 64 * 1024 * 1024;

async function readRange(path, start, length) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, start + done);
      if (bytesRead === 0) throw new Error(`${path} ended at ${start + done}, expected ${start + length}`);
      done += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

/** Runs `task(i)` for i in [0, count) with at most `limit` at once; the first failure rejects. */
async function pool(count, limit, task) {
  const results = new Array(count);
  let next = 0;
  async function worker() {
    while (next < count) {
      const i = next++;
      results[i] = await task(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return results;
}

function headersFor(object) {
  return {
    'content-type': object.contentType,
    'cache-control': object.cacheControl,
    'x-amz-meta-sha256': object.sha256,
  };
}

async function multipart(client, object, { partSize, concurrency, log }) {
  const parts = Math.ceil(object.size / partSize);
  const uploadId = await client.createMultipart(object.key, headersFor(object));
  try {
    const etags = await pool(parts, concurrency, async (i) => {
      const start = i * partSize;
      const body = await readRange(object.path, start, Math.min(partSize, object.size - start));
      const etag = await client.uploadPart(object.key, uploadId, i + 1, body);
      log(`${object.key}: part ${i + 1}/${parts}`);
      return etag;
    });
    await client.completeMultipart(object.key, uploadId, etags);
  } catch (error) {
    await client.abortMultipart(object.key, uploadId);
    throw error;
  }
}

/** What's wrong with the object at the key after upload, or undefined. */
export function headProblem(head, object) {
  if (!head) return 'missing after upload';
  if (head.size !== object.size) return `size ${head.size}, expected ${object.size}`;
  if (head.sha256 !== object.sha256) return `sha256 metadata ${head.sha256}, expected ${object.sha256}`;
  if (head.contentType !== object.contentType) return `Content-Type ${head.contentType}`;
  if (head.cacheControl !== object.cacheControl) return `Cache-Control ${head.cacheControl}`;
  return undefined;
}

/** Returns 'present' (the same bytes are already there) or 'uploaded'. Throws otherwise. */
export async function uploadObject(
  client,
  object,
  { partSize = PART_SIZE, concurrency = 4, log = () => {} } = {},
) {
  const existing = await client.head(object.key);
  if (existing && existing.sha256 === object.sha256 && existing.size === object.size) {
    const problem = headProblem(existing, object);
    if (problem) throw new Error(`${object.key} is hosted with ${problem}`);
    return 'present';
  }
  if (existing)
    throw new Error(
      `${object.key} already holds other bytes (sha256 ${existing.sha256 ?? 'unknown'}): a hosted key never changes; give the component a new version`,
    );
  if (object.size <= partSize) {
    await client.put(object.key, await readRange(object.path, 0, object.size), headersFor(object));
  } else {
    await multipart(client, object, { partSize, concurrency, log });
  }
  const problem = headProblem(await client.head(object.key), object);
  if (problem) throw new Error(`${object.key}: ${problem}`);
  return 'uploaded';
}
