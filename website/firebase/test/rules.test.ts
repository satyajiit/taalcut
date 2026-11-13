// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { CONTACT_TOPICS, contactEntry, waitlistEntry } from '#lib/firebase/entries';

/**
 * firestore.rules against the emulator. `pnpm test:rules` starts it (firebase emulators:exec sets
 * FIRESTORE_EMULATOR_HOST); a plain `pnpm test` has no emulator and skips this file.
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!emulator)('firestore.rules', { timeout: 20_000 }, () => {
  let env: RulesTestEnvironment;
  let db: Firestore;

  beforeAll(async () => {
    const [host, port] = emulator!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-taalcut',
      firestore: {
        rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
        host,
        port: Number(port),
      },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    db = env.unauthenticatedContext().firestore() as unknown as Firestore;
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  /** A sign-up exactly as the site builds it, with the server's timestamp. */
  function signUp(over: Record<string, unknown> = {}) {
    const entry = waitlistEntry({
      email: ' Asha@Example.com ',
      platforms: ['ubuntu', 'macos'],
      make: 'travel',
      source: 'ig',
    })!;
    return { ...entry, platforms: [...entry.platforms], createdAt: serverTimestamp(), ...over };
  }

  function message(over: Record<string, unknown> = {}) {
    const entry = contactEntry({
      name: 'Asha',
      email: 'asha@example.com',
      topic: 'press',
      message: 'Hello from a magazine.',
    })!;
    return { ...entry, createdAt: serverTimestamp(), ...over };
  }

  async function seed(path: string, data: Record<string, unknown>) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
    });
  }

  describe('waitlist', () => {
    it('takes a sign-up the site builds, keyed by its normalised email', async () => {
      await assertSucceeds(setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp()));
    });

    it('takes no platforms and no answer to "what do you make"', async () => {
      await assertSucceeds(
        setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp({ platforms: [], make: null })),
      );
    });

    it('refuses an id that is not the email', async () => {
      await assertFails(setDoc(doc(db, 'waitlist', 'someone@example.com'), signUp()));
    });

    it('refuses a key it does not know, and a missing one', async () => {
      await assertFails(setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp({ referrer: 'x' })));
      const { make: _make, ...noMake } = signUp();
      await assertFails(setDoc(doc(db, 'waitlist', 'asha@example.com'), noMake));
    });

    it('refuses a time that is not the server’s', async () => {
      await assertFails(
        setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp({ createdAt: Timestamp.fromMillis(0) })),
      );
    });

    it('refuses a bad shape', async () => {
      const id = 'asha@example.com';
      for (const bad of [
        { platforms: 'macos' },
        { platforms: ['macos', 'macos'] },
        { platforms: ['macos', 'amiga'] },
        { make: 'cooking' },
        { make: 3 },
        { source: 'IG Story' },
        { source: '' },
        { source: 'x'.repeat(41) },
        { consentVersion: 'waitlist-2025-01' },
      ]) {
        await assertFails(setDoc(doc(db, 'waitlist', id), signUp(bad)));
      }
    });

    it('refuses an address the site would not send', async () => {
      for (const email of [
        'Asha@example.com',
        'asha@example',
        'asha example@x.co',
        'asha@x.c',
        `${'a'.repeat(250)}@x.co`,
      ]) {
        await assertFails(setDoc(doc(db, 'waitlist', email), signUp({ email })));
      }
    });

    it('refuses a second sign-up for the same address (an update)', async () => {
      await assertSucceeds(setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp()));
      await assertFails(setDoc(doc(db, 'waitlist', 'asha@example.com'), signUp()));
      await assertFails(updateDoc(doc(db, 'waitlist', 'asha@example.com'), { make: 'food' }));
    });

    it('lets nobody read, list or delete', async () => {
      await seed('waitlist/asha@example.com', { email: 'asha@example.com' });
      await assertFails(getDoc(doc(db, 'waitlist', 'asha@example.com')));
      await assertFails(getDocs(collection(db, 'waitlist')));
      await assertFails(deleteDoc(doc(db, 'waitlist', 'asha@example.com')));
    });
  });

  describe('contact', () => {
    it('takes a message the site builds', async () => {
      await assertSucceeds(addDoc(collection(db, 'contact'), message()));
    });

    it('takes every topic the contact page has, each under its own name', async () => {
      for (const topic of CONTACT_TOPICS) await assertSucceeds(addDoc(collection(db, 'contact'), message({ topic })));
    });

    it('refuses a bad shape', async () => {
      for (const bad of [
        { name: '' },
        { name: 'x'.repeat(81) },
        { email: 'asha@' },
        { topic: 'sales' },
        { message: '' },
        { message: 'x'.repeat(2001) },
        { createdAt: Timestamp.fromMillis(0) },
        { phone: '555' },
      ]) {
        await assertFails(addDoc(collection(db, 'contact'), message(bad)));
      }
    });

    it('lets nobody read, list, update or delete', async () => {
      await seed('contact/m1', { name: 'Asha' });
      await assertFails(getDoc(doc(db, 'contact', 'm1')));
      await assertFails(getDocs(collection(db, 'contact')));
      await assertFails(updateDoc(doc(db, 'contact', 'm1'), { name: 'B' }));
      await assertFails(deleteDoc(doc(db, 'contact', 'm1')));
    });
  });

  it('denies every other path', async () => {
    await assertFails(setDoc(doc(db, 'users', 'asha'), { name: 'Asha' }));
    await assertFails(getDoc(doc(db, 'users', 'asha')));
  });
});
