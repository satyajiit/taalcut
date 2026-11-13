// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The few S3 calls the release path makes against one R2 bucket (path-style, region "auto"): HeadObject,
 * PutObject, and multipart upload (create, part, complete, abort). Every body's sha256 is signed in
 * (x-amz-content-sha256), so R2 refuses any byte that differs from what was hashed here. Transient failures
 * (network, 5xx, 429) are retried with backoff; anything else throws with the status and R2's error code.
 */
import { createHash } from 'node:crypto';
import { EMPTY_SHA256, keyPath, signRequest } from './sigv4.mjs';

const RETRIES = 5;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(text) {
  return /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
}

export class R2Error extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * config: { accountId, bucket, accessKeyId, secretAccessKey, endpoint? } (endpoint defaults to R2's for the
 * account; tests point it at a local server). fetch and sleep are injectable.
 */
export function r2Client(config, { fetch = globalThis.fetch, sleep = delay } = {}) {
  const endpoint = config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  const objectUrl = (key, query = '') => `${endpoint}/${config.bucket}/${keyPath(key)}${query}`;

  async function send(method, url, { headers = {}, body, ok = [200] } = {}) {
    const payloadHash = body ? sha256(body) : EMPTY_SHA256;
    for (let attempt = 1; ; attempt++) {
      const signed = signRequest({ method, url, headers, payloadHash, credentials, region: 'auto' });
      let response;
      try {
        response = await fetch(url, { method, headers: signed, body });
      } catch (error) {
        if (attempt >= RETRIES) throw new R2Error(`${method} ${url}: ${error.message}`, 0);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (ok.includes(response.status)) return response;
      const text = await response.text();
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable || attempt >= RETRIES)
        throw new R2Error(
          `${method} ${url}: HTTP ${response.status} ${errorCode(text) ?? ''}`.trim(),
          response.status,
        );
      await sleep(500 * 2 ** attempt);
    }
  }

  return {
    /** undefined when the key doesn't exist. */
    async head(key) {
      // identity: R2 compresses text for a client that accepts gzip, and then sends no Content-Length.
      const response = await send('HEAD', objectUrl(key), {
        headers: { 'accept-encoding': 'identity' },
        ok: [200, 404],
      });
      if (response.status === 404) return undefined;
      const h = response.headers;
      return {
        size: Number(h.get('content-length')),
        sha256: h.get('x-amz-meta-sha256') ?? undefined,
        contentType: h.get('content-type') ?? undefined,
        cacheControl: h.get('cache-control') ?? undefined,
        etag: h.get('etag') ?? undefined,
      };
    },

    async put(key, body, headers) {
      const response = await send('PUT', objectUrl(key), { headers, body });
      return response.headers.get('etag');
    },

    async createMultipart(key, headers) {
      const response = await send('POST', objectUrl(key, '?uploads'), { headers });
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(await response.text())?.[1];
      if (!id) throw new R2Error(`CreateMultipartUpload ${key}: no UploadId`, response.status);
      return id;
    },

    async uploadPart(key, uploadId, partNumber, body) {
      const query = `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      const response = await send('PUT', objectUrl(key, query), { body });
      const etag = response.headers.get('etag');
      if (!etag) throw new R2Error(`UploadPart ${key} #${partNumber}: no ETag`, response.status);
      return etag;
    },

    async completeMultipart(key, uploadId, etags) {
      const parts = etags
        .map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`)
        .join('');
      const body = Buffer.from(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`);
      const query = `?uploadId=${encodeURIComponent(uploadId)}`;
      const response = await send('POST', objectUrl(key, query), {
        body,
        headers: { 'content-type': 'application/xml' },
      });
      const text = await response.text();
      // S3 can answer 200 and still fail the completion in the body.
      if (/<Error>/.test(text))
        throw new R2Error(`CompleteMultipartUpload ${key}: ${errorCode(text)}`, response.status);
    },

    async abortMultipart(key, uploadId) {
      await send('DELETE', objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`), {
        ok: [204, 200, 404],
      });
    },
  };
}
