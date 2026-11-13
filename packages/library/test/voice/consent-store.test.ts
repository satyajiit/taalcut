// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * VoiceConsentStore (P3-B6): put keeps a consent with the claimed capture moved into the store's folder (0600),
 * only when its sha256 is the consent's; the recording's path is served for the clone; the clone is set and
 * cleared; delete takes the row and the file; rows are core's VoiceConsent both ways.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { err, newId, NotFoundError, ok, unwrap, type VoiceCaptureId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createVoiceConsentStore } from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { writeCapture } from './captures';

function setup() {
  const root = tempDir();
  const captures = join(root, 'voice-consent', 'captures');
  const dir = join(root, 'voice-consent', 'recordings');
  mkdirSync(captures, { recursive: true });
  const located: VoiceCaptureId[] = [];
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const store = createVoiceConsentStore(db, {
    dir,
    captures: {
      locate: async (key) => {
        located.push(key);
        return key === MISSING
          ? err(NotFoundError({ entity: 'capture', id: key }))
          : ok(join(captures, `${key}.wav`));
      },
    },
  });
  /** A finished capture main wrote: returns its key and the consent that hashes it. */
  const capture = (bytes?: string) => writeCapture(captures, clock.now(), bytes);
  return { db, store, captures, dir, located, clock, capture };
}

const MISSING = newId<'VoiceCapture'>();

describe('voice consent store', () => {
  it('keeps the consent and moves the claimed recording into its own folder', async () => {
    const env = setup();
    const { captureKey, consent } = env.capture();
    unwrap(await env.store.put(consent, { captureKey }));

    expect(env.located).toEqual([captureKey]);
    expect(existsSync(join(env.captures, `${captureKey}.wav`))).toBe(false);
    const path = unwrap(await env.store.recordingPath(consent.id));
    expect(path).toBe(join(env.dir, `${consent.id}.wav`));
    expect(readFileSync(path, 'utf8')).toBe('RIFF-pretend-recording');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(env.dir).mode & 0o777).toBe(0o700);
    expect(unwrap(await env.store.get(consent.id))).toEqual(consent);
    expect(unwrap(await env.store.get(newId<'VoiceConsent'>()))).toBeNull();
  });

  it('refuses a capture that is not the recording the consent was checked against', async () => {
    const env = setup();
    const { captureKey, consent } = env.capture();
    const swapped = await env.store.put({ ...consent, recordingSha256: 'a'.repeat(64) }, { captureKey });
    expect(!swapped.ok && swapped.error.code).toBe('library.voice_recording_mismatch');
    expect(existsSync(join(env.captures, `${captureKey}.wav`))).toBe(true);
    expect(unwrap(await env.store.list())).toEqual([]);

    const gone = await env.store.put(consent, { captureKey: MISSING });
    expect(!gone.ok && gone.error.code).toBe('core.not_found');
    const notAKey = await env.store.put(consent, { captureKey: '../../etc/passwd' });
    expect(!notAKey.ok && notAKey.error.code).toBe('core.validation');
    const short = await env.store.put({ ...consent, recordingDurationMs: 5_000 }, { captureKey });
    expect(!short.ok && short.error.code).toBe('core.validation');
    const unwritten = env.capture();
    const noFile = await env.store.put(unwritten.consent, { captureKey: newId<'VoiceCapture'>() });
    expect(!noFile.ok && noFile.error.code).toBe('core.not_found');
  });

  it('refuses a second consent with the same id and keeps the first recording', async () => {
    const env = setup();
    const first = env.capture();
    unwrap(await env.store.put(first.consent, { captureKey: first.captureKey }));
    const second = env.capture('another take');
    const again = await env.store.put(
      { ...first.consent, recordingSha256: second.consent.recordingSha256 },
      { captureKey: second.captureKey },
    );
    expect(!again.ok && again.error.code).toBe('core.conflict');
    expect(readFileSync(unwrap(await env.store.recordingPath(first.consent.id)), 'utf8')).toBe(
      'RIFF-pretend-recording',
    );
    expect(existsSync(join(env.captures, `${second.captureKey}.wav`))).toBe(true);
  });

  it('keeps no consent when the recording cannot be moved in', async () => {
    const env = setup();
    const { captureKey, consent } = env.capture();
    mkdirSync(join(env.dir, `${consent.id}.wav`), { recursive: true }); // the move's target is taken
    const put = await env.store.put(consent, { captureKey });
    expect(put.ok).toBe(false);
    expect(unwrap(await env.store.get(consent.id))).toBeNull();
    expect(existsSync(join(env.captures, `${captureKey}.wav`))).toBe(true);
  });

  it('lists newest first, sets and clears the clone, and deletes the row and the file', async () => {
    const env = setup();
    const older = env.capture('older');
    unwrap(await env.store.put(older.consent, { captureKey: older.captureKey }));
    env.clock.advance(1000);
    const newer = env.capture('newer');
    unwrap(await env.store.put(newer.consent, { captureKey: newer.captureKey }));
    expect(unwrap(await env.store.list()).map((c) => c.id)).toEqual([newer.consent.id, older.consent.id]);

    const clone = { provider: 'elevenlabs', voiceId: 'v123', createdAt: 5 };
    unwrap(await env.store.setClone(older.consent.id, clone));
    expect(unwrap(await env.store.get(older.consent.id))?.clone).toEqual(clone);
    unwrap(await env.store.setClone(older.consent.id, null));
    expect(unwrap(await env.store.get(older.consent.id))?.clone).toBeNull();
    const unknown = await env.store.setClone(newId<'VoiceConsent'>(), null);
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
    const bad = await env.store.setClone(older.consent.id, { provider: '', voiceId: 'v', createdAt: 1 });
    expect(!bad.ok && bad.error.code).toBe('core.validation');

    const path = unwrap(await env.store.recordingPath(older.consent.id));
    unwrap(await env.store.delete(older.consent.id));
    expect(existsSync(path)).toBe(false);
    expect(unwrap(await env.store.get(older.consent.id))).toBeNull();
    unwrap(await env.store.delete(older.consent.id)); // withdrawing twice is fine
    const noPath = await env.store.recordingPath(older.consent.id);
    expect(!noPath.ok && noPath.error.code).toBe('core.not_found');
  });

  it('answers not found for a consent whose recording went, and an error for a row that no longer parses', async () => {
    const env = setup();
    const { captureKey, consent } = env.capture();
    unwrap(await env.store.put(consent, { captureKey }));
    const path = unwrap(await env.store.recordingPath(consent.id));
    rmSync(path);
    const missing = await env.store.recordingPath(consent.id);
    expect(!missing.ok && missing.error.code).toBe('core.not_found');

    env.db.driver.prepare(`UPDATE voice_consents SET language = 'Hindi!' WHERE id = ?`).run(consent.id);
    const read = await env.store.get(consent.id);
    expect(!read.ok && read.error.code).toBe('core.validation');
    const listed = await env.store.list();
    expect(!listed.ok && listed.error.code).toBe('core.validation');
  });
});
