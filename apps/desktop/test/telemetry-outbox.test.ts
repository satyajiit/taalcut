// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X7 outbox: the 5,000 cap, the file adapter when there is no library
 * database, and the library outbox (createTelemetryOutbox) when there is.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClockToken,
  createContainer,
  createManualClock,
  createMemorySettingsStore,
  SettingsStoreToken,
  TelemetryToken,
} from '@taalcut/core';
import { createTelemetryOutbox, openDatabase } from '@taalcut/library';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { LibraryDatabaseToken, UtilityConfigToken } from '../src/shared/tokens';
import {
  adaptLibraryTelemetryOutbox,
  createFileTelemetryOutbox,
  registerAgentTelemetry,
  TELEMETRY_OUTBOX_CAP,
  TelemetryServiceToken,
  telemetryOutboxFile,
} from '../src/utility/roots/telemetry';
import { allow, harness, sessionEvent, type Harness } from './helpers/telemetry';

const open: Harness[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const box of open.splice(0)) box.service.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-telemetry-'));
  dirs.push(dir);
  return dir;
}

describe('outbox', () => {
  it('keeps 5,000 and drops the oldest', async () => {
    const box = harness();
    open.push(box);
    await allow(box.settings);
    for (let i = 0; i < TELEMETRY_OUTBOX_CAP + 1; i += 1) box.service.record(sessionEvent());
    await box.service.settled();
    const rows = await box.outbox.take(TELEMETRY_OUTBOX_CAP + 1);
    expect(rows).toHaveLength(TELEMETRY_OUTBOX_CAP);
    expect(rows[0]?.envelope.seq).toBe(2);
    expect(rows[TELEMETRY_OUTBOX_CAP - 1]?.envelope.seq).toBe(TELEMETRY_OUTBOX_CAP + 1);
  }, 20_000);

  it('survives a close and reopen, and drops an envelope the schema rejects', async () => {
    const dir = scratch();
    const file = join(dir, 'nested', 'telemetry-outbox.json');
    const first = createFileTelemetryOutbox(file);
    const box = harness({ outbox: first, endpoint: 'http://127.0.0.1:9' });
    open.push(box);
    await allow(box.settings);
    box.service.record(sessionEvent());
    await box.service.settled();
    box.service.stop();

    expect(statSync(file).mode & 0o777).toBe(0o600);
    const reopened = createFileTelemetryOutbox(file);
    const kept = await reopened.take(10);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.envelope.event).toMatchObject({ name: 'session.started' });
    const row = kept[0];
    if (!row) return;
    await reopened.ack([row.id]);
    expect(await createFileTelemetryOutbox(file).take(10)).toEqual([]);

    const sample = row.envelope;
    const seeded = Array.from({ length: TELEMETRY_OUTBOX_CAP }, (_, index) => ({
      id: index + 1,
      envelope: { ...sample, seq: index + 1 },
    }));
    const capped = join(dir, 'capped.json');
    writeFileSync(capped, JSON.stringify({ nextId: TELEMETRY_OUTBOX_CAP + 1, rows: seeded }), {
      mode: 0o600,
    });
    const fileOutbox = createFileTelemetryOutbox(capped);
    await fileOutbox.append({ ...sample, seq: TELEMETRY_OUTBOX_CAP + 1 });
    const rows = await fileOutbox.take(TELEMETRY_OUTBOX_CAP + 1);
    expect(rows).toHaveLength(TELEMETRY_OUTBOX_CAP);
    expect(rows[0]?.envelope.seq).toBe(2);
    expect(rows[TELEMETRY_OUTBOX_CAP - 1]?.envelope.seq).toBe(TELEMETRY_OUTBOX_CAP + 1);

    const dirty = join(dir, 'dirty.json');
    writeFileSync(
      dirty,
      JSON.stringify({
        nextId: 3,
        rows: [
          { id: 1, envelope: { ...sample, fileName: 'clip.mov' } },
          { id: 2, envelope: sample },
        ],
      }),
    );
    const clean = await createFileTelemetryOutbox(dirty).take(10);
    expect(clean.map((item) => item.id)).toEqual([2]);
  });

  it('registers a file outbox that stays empty while the baked URL is off', async () => {
    const dir = scratch();
    const settings = createMemorySettingsStore();
    const clock = createManualClock(1_700_000_000_000);
    const config: UtilityConfig = {
      process: 'agent',
      dbPath: ':memory:',
      userData: dir,
      resourcesPath: dir,
      packaged: false,
      componentManifest: join(dir, 'manifest.json'),
    };
    const container = createContainer();
    container.value(SettingsStoreToken, settings);
    container.value(ClockToken, clock);
    container.value(UtilityConfigToken, config);
    registerAgentTelemetry(container, '1.4.0');
    const service = container.resolve(TelemetryServiceToken);
    try {
      await allow(settings);
      service.record(sessionEvent());
      await service.settled();
      expect(await createFileTelemetryOutbox(telemetryOutboxFile(dir)).take(10)).toEqual([]);
      expect(container.resolve(TelemetryToken)).toBe(service);
    } finally {
      await container.dispose();
    }
  });

  it('queues through the library outbox and registers that service as TelemetryToken', async () => {
    const opened = openDatabase({ path: ':memory:' });
    if (!opened.ok) throw new Error(opened.error.code);
    const db = opened.value;
    const library = createTelemetryOutbox(db);
    const outbox = adaptLibraryTelemetryOutbox(library);
    const box = harness({ outbox, transport: { post: async () => false } });
    try {
      await outbox.append({} as never);
      expect(library.count()).toBe(0);
      await allow(box.settings);
      box.service.record(sessionEvent());
      await box.service.settled();
      expect(library.count()).toBe(1);
      expect((await box.service.state()).queued).toBe(1);
      const taken = await outbox.take(10);
      await outbox.ack(taken.map((row) => row.id));
      expect(library.count()).toBe(0);
    } finally {
      box.service.stop();
    }

    const container = createContainer();
    container.value(SettingsStoreToken, createMemorySettingsStore());
    container.value(ClockToken, createManualClock(1_700_000_000_000));
    container.value(LibraryDatabaseToken, db);
    registerAgentTelemetry(container, '1.4.0');
    const service = container.resolve(TelemetryServiceToken);
    expect(container.resolve(TelemetryToken)).toBe(service);
    await container.dispose();
    db.close();
  });
});
