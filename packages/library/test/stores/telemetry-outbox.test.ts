// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X7: the telemetry outbox keeps only valid envelopes (checked on append
 * and on take), at most 5,000 of them oldest-first, and survives a reopen.
 */
import { join } from 'node:path';
import { newId, unwrap, type TelemetryEnvelope } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTelemetryOutbox, openDatabase, TELEMETRY_OUTBOX_CAP } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';

const installId = newId<'Install'>();
const sessionId = newId<'TelemetrySession'>();

function envelope(seq: number): TelemetryEnvelope {
  return {
    v: 1,
    installId,
    sessionId,
    seq,
    at: 1_760_000_000_000 + seq,
    event: {
      name: 'session.started',
      appVersion: '0.2.0-alpha.3',
      channel: 'alpha',
      osMajor: 15,
      tier: 'recommended',
      locale: 'en',
      profile: 'balanced',
    },
  };
}

describe('telemetry outbox', () => {
  it('takes oldest first, acknowledges, and clears', () => {
    const outbox = createTelemetryOutbox(openTestDb({ file: false }));
    const ids = [1, 2, 3].map((seq) => unwrap(outbox.append(envelope(seq))));
    const taken = unwrap(outbox.take(2));
    expect(taken.map((q) => q.envelope.seq)).toEqual([1, 2]);
    expect(taken.map((q) => q.id)).toEqual(ids.slice(0, 2));
    expect(unwrap(outbox.ack(taken.map((q) => q.id)))).toBe(2);
    expect(unwrap(outbox.take(10)).map((q) => q.envelope.seq)).toEqual([3]);
    expect(unwrap(outbox.ack([]))).toBe(0);
    expect(unwrap(outbox.clear())).toBe(1);
    expect(outbox.count()).toBe(0);
  });

  it('refuses anything that isn’t a strict envelope: no file names, text or project ids fit', () => {
    const outbox = createTelemetryOutbox(openTestDb({ file: false }));
    const withPath = { ...envelope(1), fileName: 'Diwali.mov' } as unknown as TelemetryEnvelope;
    const withProject = { ...envelope(1), projectId: newId<'Project'>() } as unknown as TelemetryEnvelope;
    const wrongEvent = {
      ...envelope(1),
      event: { name: 'chat.message', text: 'hello' },
    } as unknown as TelemetryEnvelope;
    for (const bad of [withPath, withProject, wrongEvent]) {
      const refused = outbox.append(bad);
      expect(!refused.ok && refused.error.code).toBe('core.validation');
    }
    expect(outbox.count()).toBe(0);
  });

  it('drops rows that no longer parse instead of sending them', () => {
    const db = openTestDb({ file: false });
    const outbox = createTelemetryOutbox(db);
    unwrap(outbox.append(envelope(1)));
    // An envelope written by an older app whose event the catalogue no longer has.
    db.driver
      .prepare('INSERT INTO telemetry_outbox (envelope, created_at) VALUES (?, 0)')
      .run(JSON.stringify({ ...envelope(2), event: { name: 'retired.event' } }));
    unwrap(outbox.append(envelope(3)));
    expect(unwrap(outbox.take(2)).map((q) => q.envelope.seq)).toEqual([1, 3]);
    expect(outbox.count()).toBe(2);
  });

  it(`keeps at most ${TELEMETRY_OUTBOX_CAP}, dropping the oldest, and never reuses an id`, () => {
    const outbox = createTelemetryOutbox(openTestDb({ file: false }), { cap: 5 });
    for (let seq = 1; seq <= 8; seq++) unwrap(outbox.append(envelope(seq)));
    const kept = unwrap(outbox.take(10));
    expect(kept.map((q) => q.envelope.seq)).toEqual([4, 5, 6, 7, 8]);
    unwrap(outbox.clear());
    const next = unwrap(outbox.append(envelope(9)));
    expect(next).toBeGreaterThan(kept.at(-1)!.id);
    expect(unwrap(outbox.ack(kept.map((q) => q.id)))).toBe(0); // a stale ack can't drop the new one
    expect(outbox.count()).toBe(1);
  });

  it('survives a reopen', () => {
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path }));
    unwrap(createTelemetryOutbox(db).append(envelope(1)));
    db.close();
    const again = unwrap(openDatabase({ path }));
    expect(unwrap(createTelemetryOutbox(again).take(5)).map((q) => q.envelope.seq)).toEqual([1]);
    again.close();
  });
});
