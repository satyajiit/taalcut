// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FIREBASE_SETUP, MEASUREMENT_ID } from '../firebase/config';
import { currentChoice } from './choice';
import type * as SdkModule from './sdk';

/**
 * The site's way to Analytics. Nothing here imports the SDK: `sdk.ts` arrives through a dynamic import when
 * AnalyticsBoot starts it, after the page has loaded. A build without a measurement id (tests, previews, a closed
 * build) never loads it, and every call here does nothing.
 */

type Counter = NonNullable<Awaited<ReturnType<typeof SdkModule.startCounter>>>;

/** Whether this build counts visits at all. */
export const ANALYTICS_ON = MEASUREMENT_ID !== null;

/** Events sent before the SDK arrived, sent once it does (a form sent in the first seconds). Bounded. */
const queue: { name: string; params?: Readonly<Record<string, string | number>> }[] = [];
const QUEUE_MAX = 20;

let counter: Counter | null = null;
let starting: Promise<Counter | null> | null = null;

/** The `ga-disable-<id>` flag the tag reads before every hit: set, nothing is sent. */
function setDisabled(disabled: boolean): void {
  if (MEASUREMENT_ID === null) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`] = disabled;
}

/** Loads the SDK and counts this page, unless the visitor turned analytics off. Safe to call more than once. */
export function startAnalytics(): void {
  if (MEASUREMENT_ID === null || FIREBASE_SETUP.mode !== 'live' || currentChoice() === 'off') return;
  setDisabled(false);
  if (counter) {
    counter.enable(true);
    return;
  }
  const { options } = FIREBASE_SETUP;
  const id = MEASUREMENT_ID;
  starting ??= import('./sdk')
    .then((sdk) => sdk.startCounter(options, id))
    .then((ready) => {
      counter = ready;
      for (const event of queue.splice(0)) ready?.log(event.name, event.params);
      return ready;
    })
    .catch(() => {
      // A blocked or failed download: this visit isn't counted, and the next page tries again.
      starting = null;
      return null;
    });
}

/**
 * Stops counting at once: the flag first (no further hit leaves this page), then the SDK's own switch, then the
 * cookies the tag set, so a returning visit can't be linked to this one.
 */
export function stopAnalytics(): void {
  if (MEASUREMENT_ID === null) return;
  setDisabled(true);
  counter?.enable(false);
  queue.length = 0;
  clearAnalyticsCookies(document, location.hostname);
}

/** Counts an event (a sign-up, a message). Does nothing when the build or the visitor has analytics off. */
export function track(name: string, params?: Readonly<Record<string, string | number>>): void {
  if (!ANALYTICS_ON || currentChoice() === 'off') return;
  if (counter) counter.log(name, params);
  else if (queue.length < QUEUE_MAX) queue.push({ name, params });
}

/**
 * Counts a page the visitor moved to inside the site. The tag counts the first page itself; it can't see the rest,
 * because Next navigates through its own copy of `history.pushState`, which the tag's history listener never wraps.
 * Before the SDK is ready nothing is queued: the tag's own first count then covers the page the visitor is on.
 */
export function countPageView(fromPath: string, title: string): void {
  if (!counter || currentChoice() === 'off') return;
  counter.log('page_view', {
    page_location: location.href,
    page_title: title,
    page_referrer: new URL(fromPath, location.origin).href,
  });
}

/**
 * The new page's title: Next streams a page's metadata after the page itself, so right after a navigation the
 * document can still carry the old title, or none. Resolves once the title is neither, or after `ms` with what's there.
 */
export function settledTitle(stale: string, ms = 1500): Promise<string> {
  const fresh = () => document.title !== '' && document.title !== stale;
  if (fresh()) return Promise.resolve(document.title);
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(document.title);
    };
    const observer = new MutationObserver(() => {
      if (fresh()) done();
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(done, ms);
  });
}

/** The tag's cookies: `_ga`, and `_ga_<id>` for each measurement id. */
export function analyticsCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((part) => part.split('=')[0]!.trim())
    .filter((name) => name === '_ga' || name.startsWith('_ga_'));
}

/** Every domain a cookie for this host can sit on: `www.taalcut.app` → `www.taalcut.app`, `taalcut.app`. */
export function cookieDomains(hostname: string): string[] {
  const labels = hostname.split('.');
  if (labels.length < 2) return [hostname];
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));
}

/** Expires the tag's cookies on this host and each parent domain it could have used. */
export function clearAnalyticsCookies(doc: Pick<Document, 'cookie'>, hostname: string): void {
  for (const name of analyticsCookieNames(doc.cookie)) {
    doc.cookie = `${name}=; Max-Age=0; path=/`;
    for (const domain of cookieDomains(hostname)) doc.cookie = `${name}=; Max-Age=0; path=/; domain=.${domain}`;
  }
}
