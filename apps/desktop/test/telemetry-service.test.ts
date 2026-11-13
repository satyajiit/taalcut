// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X7: telemetry is queued only with consent, Local only off, a usable
 * endpoint and a catalogue event. The envelope carries a project key, never
 * a project id.
 */
import { createHmac } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  callRpc,
  connectRpc,
  LOCAL_ONLY_SETTING,
  newId,
  serveRpc,
  TELEMETRY_SETTING,
  telemetryContract,
  telemetryEnvelopeSchema,
  telemetryEventSchema,
  telemetryIngestContract,
  type TelemetryEvent,
} from '@taalcut/core';
import {
  recordRecoveryOffered,
  recordSessionStarted,
  sessionStartedEvent,
  telemetryEndpoint,
  telemetryIngestRouter,
  telemetryRouter,
} from '../src/utility/roots/telemetry';
import { allow, harness, installOf, sessionEvent, type Harness } from './helpers/telemetry';

const open: Harness[] = [];
const ports: MessageChannel[] = [];

afterEach(() => {
  for (const box of open.splice(0)) box.service.stop();
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

function start(options?: Parameters<typeof harness>[0]): Harness {
  const box = harness(options);
  open.push(box);
  return box;
}

function key(salt: string, projectId: string): string {
  return createHmac('sha256', Buffer.from(salt, 'hex')).update(projectId).digest('hex').slice(0, 16);
}

describe('consent, local-only and endpoint', () => {
  it('drops everything until telemetry is turned on, and record does not block', async () => {
    let appended = false;
    const inner = start();
    const { service, settings } = start({
      outbox: {
        append: async (envelope) => {
          appended = true;
          await inner.outbox.append(envelope);
        },
        take: (limit) => inner.outbox.take(limit),
        ack: (ids) => inner.outbox.ack(ids),
        clear: () => inner.outbox.clear(),
      },
    });
    expect(service.record(sessionEvent())).toBeUndefined();
    expect(appended).toBe(false);
    await service.settled();
    expect(appended).toBe(false);
    expect(await inner.outbox.take(10)).toEqual([]);
    expect(await installOf(settings)).toBeNull();

    await allow(settings);
    service.record(sessionEvent());
    expect(appended).toBe(false);
    await service.settled();
    expect(appended).toBe(true);
    expect(await installOf(settings)).not.toBeNull();
  });

  it('drops while Local only is on, does not send, and keeps the install id', async () => {
    let posts = 0;
    const { service, settings, outbox, scheduler } = start({
      transport: {
        async post() {
          posts += 1;
          return true;
        },
      },
    });
    await allow(settings);
    service.record(sessionEvent());
    await service.settled();
    const install = await installOf(settings);
    expect(await outbox.take(10)).toHaveLength(1);

    await settings.set(LOCAL_ONLY_SETTING, true);
    service.record(sessionEvent());
    await service.settled();
    scheduler.flush();
    await service.flush();
    await service.settled();
    expect(posts).toBe(0);
    expect(await outbox.take(10)).toHaveLength(1);
    expect(await installOf(settings)).toEqual(install);

    await settings.set(LOCAL_ONLY_SETTING, false);
    scheduler.flush();
    await service.settled();
    expect(posts).toBe(1);
    expect(await outbox.take(10)).toEqual([]);
    expect((await service.state()).lastSentAt).toBe(1_700_000_000_000);
  });

  it('queues nothing when the endpoint is empty, omitted, or not https', async () => {
    expect(telemetryEndpoint()).toBeUndefined();
    const cases: { endpoint: string | null; queued: boolean }[] = [
      { endpoint: '', queued: false },
      { endpoint: null, queued: false },
      { endpoint: 'http://example.com/collect', queued: false },
      { endpoint: 'http://user:pass@127.0.0.1/t', queued: false },
      { endpoint: 'https://telemetry.example.com/v1', queued: true },
    ];
    for (const { endpoint, queued } of cases) {
      let posts = 0;
      const { service, settings, outbox } = start({
        endpoint,
        transport: {
          async post() {
            posts += 1;
            return true;
          },
        },
      });
      await allow(settings);
      service.record(sessionEvent());
      await service.settled();
      expect(await outbox.take(10), String(endpoint)).toHaveLength(queued ? 1 : 0);
      await service.flush();
      expect(posts, String(endpoint)).toBe(queued ? 1 : 0);
    }
  });

  it('forgets the install id and the queue when telemetry is turned off', async () => {
    const { service, settings, outbox } = start();
    await allow(settings, 'ALPHA1');
    service.record(sessionEvent());
    await service.settled();
    const first = await outbox.take(1);
    const previous = await installOf(settings);
    expect(previous).not.toBeNull();

    await settings.set(TELEMETRY_SETTING, { enabled: false, changedAt: 2 });
    expect(await service.state()).toEqual({ enabled: false, queued: 0 });
    expect(await installOf(settings)).toBeNull();
    expect(await outbox.take(10)).toEqual([]);

    await allow(settings);
    service.record(sessionEvent());
    await service.settled();
    const next = await installOf(settings);
    const again = await outbox.take(1);
    expect(next?.installId).not.toBe(previous?.installId);
    expect(next?.salt).not.toBe(previous?.salt);
    expect(again[0]?.envelope.installId).toBe(next?.installId);
    expect(again[0]?.envelope.sessionId).toBe(first[0]?.envelope.sessionId);
  });
});

describe('envelope', () => {
  it('links a project by 16 hex of HMAC and never stores the id or the salt', async () => {
    const { service, settings, outbox, clock } = start();
    await allow(settings, 'ALPHA1');
    const projectId = newId<'Project'>();
    const other = newId<'Project'>();
    service.record(sessionEvent(), { projectId });
    await service.settled();
    clock.advance(5_000);
    service.record(sessionEvent(), { projectId: other });
    service.record(sessionEvent(), { projectId: '/Users/a/Movies/reel.mov' as never });
    await service.settled();

    const rows = await outbox.take(10);
    expect(rows).toHaveLength(3);
    const [first, second, path] = rows;
    const install = await installOf(settings);
    expect(install).not.toBeNull();
    if (!first || !second || !path || !install) return;
    expect(first.envelope).toMatchObject({ v: 1, seq: 1, at: 1_700_000_000_000, cohort: 'ALPHA1' });
    expect(first.envelope.projectKey).toBe(key(install.salt, projectId));
    expect(first.envelope.projectKey).toMatch(/^[0-9a-f]{16}$/);
    expect(second.envelope.projectKey).toBe(key(install.salt, other));
    expect(second.envelope.projectKey).not.toBe(first.envelope.projectKey);
    expect(second.envelope).toMatchObject({
      seq: 2,
      at: 1_700_000_005_000,
      sessionId: first.envelope.sessionId,
    });
    expect(path.envelope.projectKey).toBeUndefined();
    const wire = JSON.stringify(rows);
    expect(wire).not.toContain(projectId);
    expect(wire).not.toContain(other);
    expect(wire).not.toContain(install.salt);
    expect(wire).not.toContain('/Users/a/Movies/reel.mov');
    expect(telemetryEnvelopeSchema.parse(first.envelope)).toEqual(first.envelope);
    expect(telemetryEnvelopeSchema.safeParse({ ...first.envelope, projectId }).success).toBe(false);
    expect(telemetryEnvelopeSchema.safeParse({ ...first.envelope, path: '/tmp/a.mov' }).success).toBe(false);
    expect(
      telemetryEnvelopeSchema.safeParse({ ...first.envelope, note: 'data:video/mp4;base64,AAAA' }).success,
    ).toBe(false);
    expect(telemetryEnvelopeSchema.safeParse({ ...first.envelope, projectKey: 'ZZ' }).success).toBe(false);
  });
});

const PROSE = 'A long note about the wedding film. '.repeat(40);
const BASE64 = 'A'.repeat(1_200);

describe('rejection', () => {
  const fuzz: { label: string; payload: unknown }[] = [
    {
      label: 'file name',
      payload: { ...sessionEvent(), fileName: 'clip.mov' },
    },
    {
      label: 'absolute path',
      payload: { ...sessionEvent(), path: '/Users/a/Movies/reel.mov' },
    },
    {
      label: 'data url',
      payload: {
        name: 'feedback.sent',
        withBundle: true,
        withChatText: false,
        note: 'data:video/mp4;base64,AAAA',
      },
    },
    {
      label: 'prose',
      payload: { name: 'export.survey', answer: 'yes', prose: PROSE },
    },
    {
      label: 'base64',
      payload: { name: 'feedback.sent', withBundle: false, withChatText: false, blob: BASE64 },
    },
    {
      label: 'bad version',
      payload: { ...sessionEvent(), appVersion: '1.2' },
    },
    { label: 'unknown name', payload: { name: 'clip.opened' } },
    { label: 'null', payload: null },
  ];

  it.each(fuzz)('the catalogue rejects a $label', ({ payload }) => {
    expect(telemetryEventSchema.safeParse(payload).success).toBe(false);
  });

  it('records none of the fuzz and still records a clean session', async () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'name', {
      get() {
        throw new Error('boom');
      },
    });
    const { service, settings, outbox } = start();
    await allow(settings);
    for (const { payload } of fuzz) service.record(payload as unknown as TelemetryEvent);
    expect(() => service.record(evil as unknown as TelemetryEvent)).not.toThrow();
    await service.settled();
    expect(await outbox.take(10)).toEqual([]);
    service.record(sessionEvent());
    await service.settled();
    const rows = await outbox.take(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.envelope.event).toMatchObject({ name: 'session.started' });
    expect(rows[0]?.envelope.seq).toBe(1);
  });

  it('builds session.started and recovery.offered only when the facts fit', async () => {
    const { service, outbox, settings } = start();
    await allow(settings);
    const facts = {
      appVersion: '1.2.3-alpha.1',
      channel: 'alpha' as const,
      osMajor: 15,
      tier: 'high' as const,
      locale: 'hi' as const,
      profile: 'local-only' as const,
    };
    expect(sessionStartedEvent({ ...facts, appVersion: '1.2' })).toBeUndefined();
    expect(sessionStartedEvent({ ...facts, channel: 'nightly' as 'alpha' })).toBeUndefined();
    recordSessionStarted(service, { ...facts, appVersion: '1.2' });
    recordRecoveryOffered(service, { runs: -1, jobs: 0, restored: false });
    await service.settled();
    expect(await outbox.take(10)).toEqual([]);
    recordSessionStarted(service, facts);
    recordRecoveryOffered(service, { runs: 2, jobs: 1, restored: true });
    await service.settled();
    const rows = await outbox.take(10);
    expect(rows.map((row) => row.envelope.event)).toEqual([
      { name: 'session.started', ...facts },
      { name: 'recovery.offered', runs: 2, jobs: 1, restored: true },
    ]);
  });
});

describe('routers', () => {
  it('lets a window record only its own events; ingest accepts the rest', async () => {
    const { service, settings, outbox } = start();
    await allow(settings);
    const channel = new MessageChannel();
    const ingest = new MessageChannel();
    ports.push(channel, ingest);
    serveRpc(telemetryRouter(service), channel.port1, { context: {} });
    serveRpc(telemetryIngestRouter(service), ingest.port1, { context: {} });
    const window = connectRpc(telemetryContract, channel.port2, { peer: 'agent' }).client;
    const agent = connectRpc(telemetryIngestContract, ingest.port2, { peer: 'agent' }).client;

    const refused = await callRpc(window.record({ event: sessionEvent() } as never));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('core.validation');
    expect(await outbox.take(10)).toEqual([]);

    await window.record({ event: { name: 'export.survey', answer: 'yes' } });
    await agent.record({ event: sessionEvent() });
    const rows = await outbox.take(10);
    expect(rows.map((row) => row.envelope.event.name)).toEqual(['export.survey', 'session.started']);
    expect(await window.state()).toMatchObject({ enabled: true, queued: 2 });
  });
});
