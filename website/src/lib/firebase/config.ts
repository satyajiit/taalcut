// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which Firebase the forms write to, decided at build time from NEXT_PUBLIC_* (lane L3, website/SPEC.md).
 *
 * - `live`: the owner's project, with App Check (reCAPTCHA Enterprise) on every write.
 * - `emulator`: tests. NEXT_PUBLIC_FIREBASE_EMULATOR=host:port points the forms at the Firestore emulator under the
 *   demo project; App Check is off.
 * - `closed`: no config. The forms say the waitlist opens soon and never load Firebase.
 *
 * A live build may also carry NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, which turns on visit analytics (lib/analytics). It
 * is optional: without it the forms work as before and no analytics loads. Emulator and closed builds never count.
 *
 * This module holds no SDK: the forms import it on every page, and Firebase itself loads only on intent (load.ts).
 */

/** The config keys, in the order the build's warning lists them. */
export const FIREBASE_ENV_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY',
] as const;

export const EMULATOR_ENV_KEY = 'NEXT_PUBLIC_FIREBASE_EMULATOR';

/** Optional: the web app's Analytics measurement id (`G-…`). */
export const MEASUREMENT_ENV_KEY = 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID';

/** The emulator's project: a `demo-` id never reaches a real project, so a test can't write to production. */
export const EMULATOR_PROJECT_ID = 'demo-taalcut';

export type FirebaseEnv = Partial<
  Record<(typeof FIREBASE_ENV_KEYS)[number] | typeof EMULATOR_ENV_KEY | typeof MEASUREMENT_ENV_KEY, string>
>;

export interface FirebaseWebOptions {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

export type FirebaseSetup =
  | { readonly mode: 'closed'; readonly missing: readonly string[] }
  | { readonly mode: 'emulator'; readonly projectId: string; readonly host: string; readonly port: number }
  | {
      readonly mode: 'live';
      readonly options: FirebaseWebOptions;
      readonly recaptchaKey: string;
      /** The Analytics measurement id, or null when this build doesn't count visits. */
      readonly measurementId: string | null;
    };

/** `host:port`, with a port in range; anything else is not an emulator address. */
export function parseEmulatorAddress(raw: string | undefined): { host: string; port: number } | null {
  const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\]):(\d{1,5})$/i.exec(raw?.trim() ?? '');
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

export function resolveFirebaseSetup(env: FirebaseEnv): FirebaseSetup {
  const emulator = parseEmulatorAddress(env[EMULATOR_ENV_KEY]);
  if (emulator) return { mode: 'emulator', projectId: EMULATOR_PROJECT_ID, ...emulator };
  const value = (key: (typeof FIREBASE_ENV_KEYS)[number]) => env[key]?.trim() ?? '';
  const missing = FIREBASE_ENV_KEYS.filter((key) => value(key) === '');
  if (missing.length > 0) return { mode: 'closed', missing };
  return {
    mode: 'live',
    options: {
      apiKey: value('NEXT_PUBLIC_FIREBASE_API_KEY'),
      authDomain: value('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
      projectId: value('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
      appId: value('NEXT_PUBLIC_FIREBASE_APP_ID'),
    },
    recaptchaKey: value('NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY'),
    measurementId: parseMeasurementId(env[MEASUREMENT_ENV_KEY]),
  };
}

/** A GA4 measurement id (`G-` and letters or digits), or null for anything else, so a typo can't reach the page. */
export function parseMeasurementId(raw: string | undefined): string | null {
  const id = raw?.trim() ?? '';
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null;
}

/**
 * This build's setup. Each key is written out in full so Next inlines its value into the client bundle; a loop over
 * `process.env` would read nothing in the browser.
 */
export const FIREBASE_SETUP: FirebaseSetup = resolveFirebaseSetup({
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY,
  NEXT_PUBLIC_FIREBASE_EMULATOR: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
});

/** Whether the forms can take sign-ups in this build. */
export const FORMS_OPEN = FIREBASE_SETUP.mode !== 'closed';

/** This build's Analytics measurement id: set only in a live build that names one. */
export const MEASUREMENT_ID: string | null = FIREBASE_SETUP.mode === 'live' ? FIREBASE_SETUP.measurementId : null;
