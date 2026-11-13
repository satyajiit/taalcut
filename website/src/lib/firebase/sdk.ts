// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  getFirestore,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore/lite';
import { FIREBASE_SETUP } from './config';
import type { ContactEntry } from './entries';
import { FormStepError } from './outcome';

/**
 * The Firebase SDK, loaded only when someone starts using the contact form (load.ts imports this module dynamically,
 * so it is its own chunk). Firestore Lite: one REST write per message, no listeners, no offline cache. Lite attaches App Check's
 * token to each request (its LiteAppCheckTokenProvider sends `x-firebase-appcheck`), so the full SDK isn't needed.
 */

interface Connection {
  readonly db: Firestore;
  readonly appCheck: AppCheck | null;
}

let connection: Connection | null = null;

function connect(): Connection {
  if (connection) return connection;
  const setup = FIREBASE_SETUP;
  if (setup.mode === 'closed') throw new FormStepError('load-failed');
  let app: FirebaseApp;
  let appCheck: AppCheck | null = null;
  if (setup.mode === 'emulator') {
    // The emulator takes any key and checks rules only; App Check stays off.
    app = initializeApp(
      { apiKey: 'demo-key', projectId: setup.projectId, appId: '1:0:web:0' },
      'taalcut-forms',
    );
  } else {
    app = initializeApp(setup.options, 'taalcut-forms');
    // One write per visit: no background refresh.
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(setup.recaptchaKey),
      isTokenAutoRefreshEnabled: false,
    });
  }
  const db = getFirestore(app);
  if (setup.mode === 'emulator') connectFirestoreEmulator(db, setup.host, setup.port);
  connection = { db, appCheck };
  return connection;
}

/** Asks App Check for a token before writing, so a failed check is named as one and never reaches Firestore. */
async function vouch(appCheck: AppCheck | null): Promise<void> {
  if (!appCheck) return;
  try {
    await getToken(appCheck, false);
  } catch {
    throw new FormStepError('app-check');
  }
}

/** Adds a message under `contact/` with a generated id. */
export async function writeContact(entry: ContactEntry): Promise<void> {
  const { db, appCheck } = connect();
  await vouch(appCheck);
  await addDoc(collection(db, 'contact'), {
    name: entry.name,
    email: entry.email,
    topic: entry.topic,
    message: entry.message,
    createdAt: serverTimestamp(),
  });
}
