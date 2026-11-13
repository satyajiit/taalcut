// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 review H4: `put` inserted the consent row, then moved the recording, so a kill between them left a
 * consent whose only recording stayed in main's captures folder until main's sweep deleted it an hour later, and
 * the claim answers once, so nothing could finish the move. The recording now moves in first (folder fsynced) and
 * the row follows; a kill between them leaves an unlisted recording, which the store removes before its first
 * operation in the next process.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, ok, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createVoiceConsentStore } from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { writeCapture } from './captures';

function setup() {
  const root = tempDir();
  const captures = join(root, 'voice-consent', 'captures');
  const dir = join(root, 'voice-consent', 'recordings');
  mkdirSync(captures, { recursive: true });
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  /** A store as one process opens it: the next process gets a new one over the same database and folder. */
  const open = () =>
    createVoiceConsentStore(db, {
      dir,
      captures: { locate: async (key) => ok(join(captures, `${key}.wav`)) },
    });
  /** A finished capture main wrote: returns its key and the consent that hashes it. */
  const capture = (bytes?: string) => writeCapture(captures, clock.now(), bytes);
  /** Every insert into voice_consents fails from now on, after whatever ran before it. */
  const failInserts = () =>
    db.driver
      .prepare(
        `CREATE TRIGGER refuse_consent BEFORE INSERT ON voice_consents BEGIN SELECT RAISE(ABORT, 'refused'); END`,
      )
      .run();
  return { db, dir, captures, open, capture, failInserts };
}

describe('voice consent store across a crash (H4)', () => {
  it('moves the recording in before the row, and takes it out again when the row is refused', async () => {
    const env = setup();
    const store = env.open();
    const { captureKey, consent } = env.capture();
    env.failInserts();
    const refused = await store.put(consent, { captureKey });
    expect(refused.ok).toBe(false);
    // The capture had already left main's folder when the insert was refused: the move came first.
    expect(existsSync(join(env.captures, `${captureKey}.wav`))).toBe(false);
    expect(unwrap(await store.get(consent.id))).toBeNull();
    expect(readdirSync(env.dir)).toEqual([]);
  });

  it('removes a recording a kill left without its row, before the next process does anything', async () => {
    const env = setup();
    const kept = env.capture('kept');
    unwrap(await env.open().put(kept.consent, { captureKey: kept.captureKey }));
    // The kill: a recording moved in, its row never written.
    const orphan = newId<'VoiceConsent'>();
    writeFileSync(join(env.dir, `${orphan}.wav`), 'orphaned take', { mode: 0o600 });
    // Not a recording: left alone.
    writeFileSync(join(env.dir, 'notes.txt'), 'not ours');
    mkdirSync(join(env.dir, `${newId<'VoiceConsent'>()}.wav`));

    const next = env.open();
    expect(unwrap(await next.list()).map((c) => c.id)).toEqual([kept.consent.id]);
    expect(existsSync(join(env.dir, `${orphan}.wav`))).toBe(false);
    expect(existsSync(join(env.dir, 'notes.txt'))).toBe(true);
    const path = unwrap(await next.recordingPath(kept.consent.id));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('never lets the sweep run beside a put: a put on a fresh store waits for it and keeps its own file', async () => {
    const env = setup();
    mkdirSync(env.dir, { recursive: true });
    const orphans = Array.from({ length: 20 }, () => newId<'VoiceConsent'>());
    for (const id of orphans) writeFileSync(join(env.dir, `${id}.wav`), 'orphan');
    const store = env.open();
    const { captureKey, consent } = env.capture();
    // Both start before the sweep has run; the put's file must survive it.
    const [put, listed] = await Promise.all([store.put(consent, { captureKey }), store.list()]);
    unwrap(put);
    unwrap(listed);
    expect(readdirSync(env.dir)).toEqual([`${consent.id}.wav`]);
    expect(unwrap(await store.list()).map((c) => c.id)).toEqual([consent.id]);
  });
});
