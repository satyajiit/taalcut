// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local servers for the release scripts' tests: an S3 bucket that checks what R2 checks (the SigV4 signature
 * over the headers actually received, and each body against its signed sha256), and a static file host with the
 * range behaviour of the public domain.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { signRequest } from './sigv4.mjs';

const md5 = (bytes) => `"${createHash('md5').update(bytes).digest('hex')}"`;

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => handler(req, res, Buffer.concat(chunks)));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

function signatureOk(req, credentials) {
  const auth = req.headers.authorization ?? '';
  const names = /SignedHeaders=([^,]+),/.exec(auth)?.[1].split(';') ?? [];
  const headers = Object.fromEntries(
    names
      .filter((n) => !['host', 'x-amz-date', 'x-amz-content-sha256'].includes(n))
      .map((n) => [n, req.headers[n]]),
  );
  const stamp = req.headers['x-amz-date'] ?? '';
  const date = new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
  );
  const expected = signRequest({
    method: req.method,
    url: `http://${req.headers.host}${req.url}`,
    headers,
    payloadHash: req.headers['x-amz-content-sha256'],
    credentials,
    region: 'auto',
    date,
  });
  return expected.authorization === auth;
}

/** An S3 bucket in memory. `faults` is a list of statuses to answer the next requests with. */
export async function fakeS3({ bucket, credentials }) {
  const objects = new Map();
  const uploads = new Map();
  const faults = [];
  const log = [];
  const { server, url } = await listen((req, res, body) => {
    const target = new URL(req.url, 'http://x');
    const key = decodeURIComponent(target.pathname.slice(bucket.length + 2));
    log.push(`${req.method} ${target.search}`);
    const fault = faults.shift();
    if (fault) return res.writeHead(fault).end('<Error><Code>InternalError</Code></Error>');
    if (!target.pathname.startsWith(`/${bucket}/`)) return res.writeHead(404).end();
    if (!signatureOk(req, credentials))
      return res.writeHead(403).end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
    const sha = createHash('sha256').update(body).digest('hex');
    if (sha !== req.headers['x-amz-content-sha256'])
      return res.writeHead(400).end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>');
    const q = target.searchParams;
    const meta = (headers) => ({
      'content-type': headers['content-type'],
      'cache-control': headers['cache-control'],
      'x-amz-meta-sha256': headers['x-amz-meta-sha256'],
    });
    if (req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) return res.writeHead(404).end();
      // As R2 does: text is compressed for a client that accepts it, and then has no Content-Length.
      const compressed =
        /^text\//.test(object.meta['content-type'] ?? '') &&
        /gzip|br/.test(req.headers['accept-encoding'] ?? '');
      const length = compressed ? { 'content-encoding': 'gzip' } : { 'content-length': object.body.length };
      return res.writeHead(200, { ...object.meta, ...length, etag: md5(object.body) }).end();
    }
    if (req.method === 'PUT' && q.has('partNumber')) {
      uploads.get(q.get('uploadId')).parts.set(Number(q.get('partNumber')), body);
      return res.writeHead(200, { etag: md5(body) }).end();
    }
    if (req.method === 'PUT') {
      objects.set(key, { body, meta: meta(req.headers) });
      return res.writeHead(200, { etag: md5(body) }).end();
    }
    if (req.method === 'POST' && q.has('uploads')) {
      const id = `upload-${uploads.size + 1}`;
      uploads.set(id, { key, meta: meta(req.headers), parts: new Map() });
      return res
        .writeHead(200)
        .end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'POST' && q.has('uploadId')) {
      const upload = uploads.get(q.get('uploadId'));
      const numbers = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) =>
        Number(m[1]),
      );
      objects.set(upload.key, {
        body: Buffer.concat(numbers.map((n) => upload.parts.get(n))),
        meta: upload.meta,
      });
      uploads.delete(q.get('uploadId'));
      return res.writeHead(200).end('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>');
    }
    if (req.method === 'DELETE' && q.has('uploadId')) {
      uploads.delete(q.get('uploadId'));
      return res.writeHead(204).end();
    }
    return res.writeHead(400).end();
  });
  return { url, objects, uploads, faults, log, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Serves `files` (path → { body, headers?, ranges?: false }) like the public domain: ETag, Range, If-Range. */
export async function staticHost(files) {
  const { server, url } = await listen((req, res) => {
    const file = files[new URL(req.url, 'http://x').pathname];
    if (!file) return res.writeHead(404).end();
    const etag = md5(file.body);
    const headers = { etag, 'accept-ranges': 'bytes', ...file.headers };
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const ifRange = req.headers['if-range'];
    if (range && file.ranges !== false && (!ifRange || ifRange === etag)) {
      const [start, end] = [Number(range[1]), Number(range[2])];
      const part = file.body.subarray(start, end + 1);
      res.writeHead(206, {
        ...headers,
        'content-length': part.length,
        'content-range': `bytes ${start}-${end}/${file.body.length}`,
      });
      return res.end(req.method === 'HEAD' ? undefined : part);
    }
    res.writeHead(200, { ...headers, 'content-length': file.body.length });
    res.end(req.method === 'HEAD' ? undefined : file.body);
  });
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * A file host that misbehaves on request, like the downloader lane's engine-test server: `next(path, behaviour)`
 * queues one behaviour for the next request to `path`. Behaviours: `status` (with `retryAfter`) answers that status
 * with no body; `dropAfterBytes` cuts the connection after that many body bytes; `stallAfterBytes` sends that many
 * and then nothing more; `ignoreRange` answers a range with the whole file. Otherwise it serves like the public
 * domain (ETag, open-ended Range, If-Range). `requests` records what each request asked for and got.
 */
export async function faultyHost(files) {
  const queues = new Map();
  const requests = [];
  const sockets = new Set();
  const { server, url } = await listen((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const behaviour = queues.get(path)?.shift() ?? {};
    const record = { path, range: req.headers.range, ifRange: req.headers['if-range'], status: 0 };
    requests.push(record);
    const file = files[path];
    if (behaviour.status || !file) {
      record.status = behaviour.status ?? 404;
      const headers = behaviour.retryAfter ? { 'retry-after': behaviour.retryAfter } : {};
      return res.writeHead(record.status, headers).end();
    }
    const etag = file.etag ?? md5(file.body);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    const ifRange = req.headers['if-range'];
    let body = file.body;
    const headers = { etag, 'accept-ranges': 'bytes' };
    if (range && !behaviour.ignoreRange && (!ifRange || ifRange === etag)) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : file.body.length - 1;
      if (start >= file.body.length) {
        record.status = 416;
        return res.writeHead(416, { 'content-range': `bytes */${file.body.length}` }).end();
      }
      body = file.body.subarray(start, end + 1);
      headers['content-range'] = `bytes ${start}-${end}/${file.body.length}`;
      record.status = 206;
    } else record.status = 200;
    res.writeHead(record.status, { ...headers, 'content-length': body.length });
    const cut = behaviour.dropAfterBytes ?? behaviour.stallAfterBytes;
    if (cut === undefined) return res.end(body);
    // The cut comes a moment after the bytes, so the client has read them (a stream that errors drops what it
    // still holds queued, which would make every test's resume start at zero).
    res.write(body.subarray(0, cut), () => {
      if (behaviour.dropAfterBytes !== undefined) setTimeout(() => res.socket?.destroy(), 100);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    url,
    requests,
    next(path, behaviour) {
      queues.set(path, [...(queues.get(path) ?? []), behaviour]);
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}
