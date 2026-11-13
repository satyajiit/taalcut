// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X7 transport: batches of 200, ack only after 200, exponential backoff,
 * and a dropped connection is retried. The scheduler is fake, so nothing
 * waits ten minutes.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryTelemetryOutbox,
  TELEMETRY_BATCH,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_VERSION_HEADER,
  telemetryBackoffMs,
  type TelemetryOutbox,
} from '../src/utility/roots/telemetry';
import { allow, harness, sessionEvent, type Harness } from './helpers/telemetry';

const FRAMING = new Set(['host', 'connection', 'content-length']);
const open: { box: Harness; close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const { box, close } of open.splice(0)) {
    box.service.stop();
    await close();
  }
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function listen(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    req.on('error', () => undefined);
    onRequest(req, res);
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function started(url: string): Promise<Harness> {
  const box = harness({ endpoint: url });
  await allow(box.settings);
  return box;
}

describe('batching and backoff', () => {
  it('posts at most 200 per interval and drains the rest on quit', async () => {
    const bodies: unknown[] = [];
    const seen: {
      names: string[];
      type: string | string[] | undefined;
      version: string | string[] | undefined;
      cookie: string | string[] | undefined;
    }[] = [];
    const server = await listen((req, res) => {
      seen.push({
        names: Object.keys(req.headers)
          .filter((name) => !FRAMING.has(name))
          .sort(),
        type: req.headers['content-type'],
        version: req.headers[TELEMETRY_VERSION_HEADER.toLowerCase()],
        cookie: req.headers.cookie,
      });
      void readBody(req).then((raw) => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200);
        res.end();
      });
    });
    const box = await started(server.url);
    open.push({ box, close: server.close });
    for (let i = 0; i < TELEMETRY_BATCH + 50; i += 1) box.service.record(sessionEvent());
    await box.service.settled();

    box.scheduler.flush();
    await box.service.settled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveLength(TELEMETRY_BATCH);
    expect(seen[0]).toMatchObject({
      names: ['content-type', 'x-taalcut-version'],
      type: 'application/json',
      version: '1.4.0',
      cookie: undefined,
    });
    expect(await box.outbox.take(TELEMETRY_BATCH + 50)).toHaveLength(50);

    await box.service.flush();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toHaveLength(50);
    expect(await box.outbox.take(10)).toEqual([]);
    const first = bodies[0] as { seq: number }[];
    const second = bodies[1] as { seq: number }[];
    expect(first[0]?.seq).toBe(1);
    expect(first[TELEMETRY_BATCH - 1]?.seq).toBe(TELEMETRY_BATCH);
    expect(second[0]?.seq).toBe(TELEMETRY_BATCH + 1);
    expect(second[49]?.seq).toBe(TELEMETRY_BATCH + 50);
  });

  it('acks only after 200 and backs off across two 500s', async () => {
    let hits = 0;
    const server = await listen((req, res) => {
      void readBody(req).then(() => {
        hits += 1;
        res.writeHead(hits < 3 ? 500 : 200);
        res.end();
      });
    });
    const box = await started(server.url);
    open.push({ box, close: server.close });
    box.service.record(sessionEvent());
    await box.service.settled();

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(1);
    expect(await box.outbox.take(10)).toHaveLength(1);
    expect(box.scheduler.delay()).toBe(telemetryBackoffMs(1));

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(2);
    expect(await box.outbox.take(10)).toHaveLength(1);
    expect(box.scheduler.delay()).toBe(telemetryBackoffMs(2));
    expect(telemetryBackoffMs(2)).toBeGreaterThan(telemetryBackoffMs(1));

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(3);
    expect(await box.outbox.take(10)).toEqual([]);
    expect(box.scheduler.delay()).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('retries a dropped connection and acks only the successful post', async () => {
    let hits = 0;
    const bodies: string[] = [];
    const server = await listen((req, res) => {
      hits += 1;
      if (hits === 1) {
        req.socket.destroy();
        return;
      }
      void readBody(req).then((raw) => {
        bodies.push(raw);
        res.writeHead(200);
        res.end();
      });
    });
    const box = await started(server.url);
    open.push({ box, close: server.close });
    box.service.record(sessionEvent());
    await box.service.settled();

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(1);
    expect(await box.outbox.take(10)).toHaveLength(1);
    expect(box.scheduler.delay()).toBe(telemetryBackoffMs(1));

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(2);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? 'null')).toHaveLength(1);
    expect(await box.outbox.take(10)).toEqual([]);
  });

  it('backs off and sends again when the outbox throws while sending', async () => {
    let hits = 0;
    const server = await listen((req, res) => {
      void readBody(req).then(() => {
        hits += 1;
        res.writeHead(200);
        res.end();
      });
    });
    const rows = createMemoryTelemetryOutbox();
    let broken = true;
    const outbox: TelemetryOutbox = {
      ...rows,
      async take(limit) {
        if (!broken) return rows.take(limit);
        broken = false;
        throw new Error('the outbox file went away');
      },
    };
    const box = harness({ endpoint: server.url, outbox });
    await allow(box.settings);
    open.push({ box, close: server.close });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    box.service.record(sessionEvent());
    await box.service.settled();

    box.scheduler.flush();
    await box.service.settled();
    expect(warn.mock.calls).toEqual([['[telemetry] send failed']]);
    warn.mockRestore();
    expect(hits).toBe(0);
    expect(box.scheduler.delay()).toBe(telemetryBackoffMs(1));

    box.scheduler.flush();
    await box.service.settled();
    expect(hits).toBe(1);
    expect(await box.outbox.take(10)).toEqual([]);
    expect(box.scheduler.delay()).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('finishes a flush whose outbox throws, and says so', async () => {
    const rows = createMemoryTelemetryOutbox();
    const outbox: TelemetryOutbox = {
      ...rows,
      take: async () => {
        throw new Error('the outbox file went away');
      },
    };
    const box = harness({ outbox });
    await allow(box.settings);
    open.push({ box, close: async () => undefined });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    box.service.record(sessionEvent());
    await expect(box.service.flush(1_000)).resolves.toBeUndefined();
    expect(warn.mock.calls).toEqual([['[telemetry] flush failed']]);
    warn.mockRestore();
  });
});
