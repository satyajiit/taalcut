// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AWS Signature Version 4 for S3-compatible requests (Cloudflare R2 takes it with region "auto"), header form,
 * with the payload's sha256 signed in. Node's crypto only: the release path needs four S3 calls, not an SDK.
 * Checked against AWS's published S3 examples (sigv4.test.mjs).
 */
import { createHash, createHmac } from 'node:crypto';

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const hmac = (key, text) => createHmac('sha256', key).update(text, 'utf8').digest();
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** RFC 3986 percent-encoding: everything but A–Z a–z 0–9 - . _ ~ (AWS's UriEncode). */
export function uriEncode(text) {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** An object key as a URL path: each segment encoded, the slashes kept. */
export function keyPath(key) {
  return key.split('/').map(uriEncode).join('/');
}

/** 20130524T000000Z */
export function amzDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function canonicalQuery(url) {
  return [...url.searchParams]
    .map(([name, value]) => [uriEncode(name), uriEncode(value)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/**
 * Signs a request. `url` carries an already encoded path (keyPath). `headers` are the headers to send and sign
 * (host, x-amz-date and x-amz-content-sha256 are added). Returns every header to send, Authorization included.
 */
export function signRequest({
  method,
  url,
  headers = {},
  payloadHash,
  credentials,
  region,
  service = 's3',
  date,
}) {
  const target = new URL(url);
  const stamp = amzDate(date ?? new Date());
  const day = stamp.slice(0, 8);
  const all = { ...headers, host: target.host, 'x-amz-date': stamp, 'x-amz-content-sha256': payloadHash };
  const lowered = Object.entries(all)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = lowered.map(([name]) => name).join(';');
  const canonical = [
    method,
    target.pathname || '/',
    canonicalQuery(target),
    lowered.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return {
    ...Object.fromEntries(lowered),
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
