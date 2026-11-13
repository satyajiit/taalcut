// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A local HTTP file server for download tests (no internet in tests). It
 * honours Range and If-Range like a CDN, sends ETag / Last-Modified, and can be
 * told to misbehave for the next request to a path: fail with a status, cut the
 * connection, stall, hold until released, ignore ranges or If-Range. Several
 * paths can be held at once (downloads in parallel lanes) and released one by one.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { noticeUrlFor, TEST_NOTICE, type Content } from './content';

export interface ServedFile {
  readonly content: Content;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface Behaviour {
  /** Reply with this status and an empty body. */
  readonly status?: number;
  readonly retryAfter?: string;
  /** Wait this long before sending headers. */
  readonly headerDelayMs?: number;
  /** Destroy the socket after this many body bytes. */
  readonly dropAfterBytes?: number;
  /** Stop after this many body bytes until release() is called or the client leaves. */
  readonly holdAfterBytes?: number;
  /** Always send the whole file with 200. */
  readonly ignoreRange?: boolean;
  /** Honour Range even when If-Range does not match (a non-compliant server). */
  readonly ignoreIfRange?: boolean;
  /** No Content-Length (chunked), so the client can't know the size up front. */
  readonly omitLength?: boolean;
  /** Reply 302 with this Location. */
  readonly redirectTo?: string;
}

export interface RequestRecord {
  readonly path: string;
  readonly range: string | undefined;
  readonly ifRange: string | undefined;
  /** What the client accepts: the downloader always asks for `identity` (a CDN compresses text otherwise). */
  readonly acceptEncoding: string | undefined;
  status: number;
  /** First byte offset of the body sent. */
  start: number;
  bytesSent: number;
}

export class TestServer {
  readonly files = new Map<string, ServedFile>();
  readonly requests: RequestRecord[] = [];
  private readonly behaviours = new Map<string, Behaviour[]>();
  private holdWaiters: { path: string | undefined; resolve: () => void }[] = [];
  private readonly holds = new Map<string, () => void>();

  private constructor(
    private readonly server: Server,
    readonly port: number,
  ) {}

  static async start(): Promise<TestServer> {
    const holder: { instance?: TestServer } = {};
    const server = createServer((req, res) => {
      void holder.instance!.handle(req, res).catch(() => res.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    holder.instance = new TestServer(server, (server.address() as AddressInfo).port);
    return holder.instance;
  }

  url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  /** Serves `file` at `path`, and the licence notice beside it (`noticeUrlFor`), as the host does. */
  serve(path: string, file: ServedFile): void {
    this.files.set(path, file);
    this.files.set(noticeUrlFor(path), { content: TEST_NOTICE, etag: '"notice-1"' });
  }

  /** Queues a behaviour for the next request to `path`. */
  next(path: string, behaviour: Behaviour): void {
    const queue = this.behaviours.get(path) ?? [];
    queue.push(behaviour);
    this.behaviours.set(path, queue);
  }

  /**
   * Resolves when a response (to `path`, or any) reaches its holdAfterBytes point, or at once if one is held
   * there now: on a busy machine the response can get there before the test asks.
   */
  waitForHold(path?: string): Promise<void> {
    if (path === undefined ? this.holds.size > 0 : this.holds.has(path)) return Promise.resolve();
    return new Promise((resolve) => this.holdWaiters.push({ path, resolve }));
  }

  /** Lets the held response to `path` (or every held one) go on. */
  release(path?: string): void {
    for (const [held, resume] of [...this.holds]) {
      if (path !== undefined && held !== path) continue;
      this.holds.delete(held);
      resume();
    }
  }

  /** The paths whose responses are held now. */
  held(): string[] {
    return [...this.holds.keys()];
  }

  requestsFor(path: string): RequestRecord[] {
    return this.requests.filter((r) => r.path === path);
  }

  async close(): Promise<void> {
    this.release();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const behaviour = this.behaviours.get(path)?.shift() ?? {};
    const record: RequestRecord = {
      path,
      range: req.headers.range,
      ifRange: typeof req.headers['if-range'] === 'string' ? req.headers['if-range'] : undefined,
      acceptEncoding: req.headers['accept-encoding'],
      status: 0,
      start: 0,
      bytesSent: 0,
    };
    this.requests.push(record);
    const closed = new Promise<void>((resolve) => res.on('close', resolve));
    if (behaviour.headerDelayMs) await Promise.race([delay(behaviour.headerDelayMs), closed]);
    if (behaviour.redirectTo) {
      record.status = 302;
      res.writeHead(302, { location: behaviour.redirectTo }).end();
      return;
    }
    const file = this.files.get(path);
    const status = !file ? 404 : behaviour.status;
    if (status) {
      record.status = status;
      res.writeHead(status, behaviour.retryAfter ? { 'retry-after': behaviour.retryAfter } : {}).end();
      return;
    }
    const { content, etag, lastModified } = file!;
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'content-type': 'application/octet-stream',
    };
    if (etag) headers.etag = etag;
    if (lastModified) headers['last-modified'] = lastModified;
    let start = 0;
    let end = content.size;
    record.status = 200;
    const range = behaviour.ignoreRange ? undefined : parseRange(req.headers.range);
    const ifRange = record.ifRange;
    const validatorMatches =
      !ifRange ||
      behaviour.ignoreIfRange ||
      (ifRange === etag && !etag.startsWith('W/')) ||
      ifRange === lastModified;
    if (range && validatorMatches) {
      if (range.start >= content.size) {
        record.status = 416;
        res.writeHead(416, { 'content-range': `bytes */${content.size}` }).end();
        return;
      }
      start = range.start;
      end = Math.min(range.end === undefined ? content.size : range.end + 1, content.size);
      record.status = 206;
      headers['content-range'] = `bytes ${start}-${end - 1}/${content.size}`;
    }
    if (!behaviour.omitLength) headers['content-length'] = String(end - start);
    record.start = start;
    res.writeHead(record.status, headers);
    await this.sendBody(res, content, start, end, behaviour, record, closed);
  }

  /** Holds the response to `path` until release() or the client leaves; tells whoever waits for it. */
  private async hold(path: string, closed: Promise<void>): Promise<void> {
    const released = new Promise<void>((resolve) => this.holds.set(path, resolve));
    const resume = this.holds.get(path);
    const [waiting, others] = partition(this.holdWaiters, (w) => w.path === undefined || w.path === path);
    this.holdWaiters = others;
    for (const waiter of waiting) waiter.resolve();
    await Promise.race([released, closed]);
    // The client left while held: that hold is over, and a later waitForHold mustn't take it for a new one.
    if (this.holds.get(path) === resume) this.holds.delete(path);
  }

  private async sendBody(
    res: ServerResponse,
    content: Content,
    start: number,
    end: number,
    behaviour: Behaviour,
    record: RequestRecord,
    closed: Promise<void>,
  ): Promise<void> {
    const limit = behaviour.dropAfterBytes ?? behaviour.holdAfterBytes;
    let limitHandled = limit === undefined;
    for (const chunk of content.chunks(start, end)) {
      let piece = chunk;
      while (piece.length > 0) {
        let take = piece.length;
        if (!limitHandled) take = Math.min(take, limit! - record.bytesSent);
        if (take > 0) {
          if (!(await write(res, piece.subarray(0, take), closed))) return;
          record.bytesSent += take;
          piece = piece.subarray(take);
        }
        if (!limitHandled && record.bytesSent >= limit!) {
          limitHandled = true;
          if (behaviour.dropAfterBytes !== undefined) {
            res.socket?.destroy();
            return;
          }
          await this.hold(record.path, closed);
          if (res.destroyed) return;
        }
      }
    }
    res.end();
  }
}

async function write(res: ServerResponse, data: Buffer, closed: Promise<void>): Promise<boolean> {
  if (res.destroyed) return false;
  if (!res.write(data)) {
    await Promise.race([new Promise<void>((resolve) => res.once('drain', resolve)), closed]);
  }
  return !res.destroyed;
}

function parseRange(header: string | undefined): { start: number; end: number | undefined } | undefined {
  const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header) : null;
  if (!match) return undefined;
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : undefined };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function partition<T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  return [items.filter(test), items.filter((item) => !test(item))];
}
