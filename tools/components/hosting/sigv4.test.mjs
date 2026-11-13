// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { amzDate, EMPTY_SHA256, keyPath, signRequest, uriEncode } from './sigv4.mjs';

// AWS's published example credentials and request time ("Examples of signature calculations", S3 API reference).
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const date = new Date('2013-05-24T00:00:00Z');
const base = { credentials, date, region: 'us-east-1' };
const signatureOf = (headers) => /Signature=([0-9a-f]{64})$/.exec(headers.authorization)[1];

describe('signRequest against the S3 examples', () => {
  it('GET Object with a Range header', () => {
    const headers = signRequest({
      ...base,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
    });
    assert.equal(signatureOf(headers), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
    assert.match(
      headers.authorization,
      /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request/,
    );
  });

  it('PUT Object, with a key that needs encoding and a signed payload', () => {
    const body = 'Welcome to Amazon S3.';
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const headers = signRequest({
      ...base,
      method: 'PUT',
      url: `https://examplebucket.s3.amazonaws.com/${keyPath('test$file.text')}`,
      headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadHash,
    });
    assert.equal(signatureOf(headers), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('GET Bucket lifecycle: a query parameter without a value', () => {
    const headers = signRequest({
      ...base,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/?lifecycle',
      payloadHash: EMPTY_SHA256,
    });
    assert.equal(signatureOf(headers), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });

  it('GET Bucket (list objects): query parameters sorted and encoded', () => {
    const headers = signRequest({
      ...base,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J',
      payloadHash: EMPTY_SHA256,
    });
    assert.equal(signatureOf(headers), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('encoding', () => {
  it('keeps only the unreserved characters', () => {
    assert.equal(uriEncode("a b/c$d!e'f(g)h*i~j_k.l-m"), 'a%20b%2Fc%24d%21e%27f%28g%29h%2Ai~j_k.l-m');
  });

  it('encodes a key segment by segment', () => {
    assert.equal(
      keyPath('whisper-small-q8-0/small-q8_0-5359861c/ggml small.bin'),
      'whisper-small-q8-0/small-q8_0-5359861c/ggml%20small.bin',
    );
  });

  it('formats the request time', () => {
    assert.equal(amzDate(new Date('2026-10-24T09:08:07.654Z')), '20261024T090807Z');
  });
});
