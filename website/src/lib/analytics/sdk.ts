// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { initializeApp } from 'firebase/app';
import {
  initializeAnalytics,
  isSupported,
  logEvent,
  setAnalyticsCollectionEnabled,
  setConsent,
  type Analytics,
} from 'firebase/analytics';
import type { FirebaseWebOptions } from '../firebase/config';

/**
 * Firebase Analytics, in its own chunk: load.ts imports this module dynamically once the page has loaded and gone
 * idle, so it never competes with the first paint. Its own app instance, apart from the forms' (which carries App
 * Check). Advertising storage, ad personalisation and Google signals are off: the site counts visits and nothing else.
 */

export interface Counter {
  log(name: string, params?: Readonly<Record<string, string | number>>): void;
  enable(on: boolean): void;
}

export async function startCounter(options: FirebaseWebOptions, measurementId: string): Promise<Counter | null> {
  // No IndexedDB, cookies off, or a browser extension page: the SDK can't run, so the site doesn't count this visit.
  if (!(await isSupported())) return null;
  const app = initializeApp({ ...options, measurementId }, 'taalcut-analytics');
  // Read at initialisation, so it comes first.
  setConsent({
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  const analytics: Analytics = initializeAnalytics(app, {
    config: { allow_google_signals: false, allow_ad_personalization_signals: false },
  });
  return {
    log(name, params) {
      logEvent(analytics, name, params);
    },
    enable(on) {
      setAnalyticsCollectionEnabled(analytics, on);
    },
  };
}
