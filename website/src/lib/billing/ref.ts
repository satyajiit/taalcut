// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tag a link brought the visitor with (`?ref=producthunt`), which the billing service may answer with a launch
 * price. The tag a visit arrived with is kept for as long as the page stays open, handed to /premium/'s quote, and
 * written into every link to /premium/ (`withRef`), so a new tab or a reload of that page still carries it. In
 * memory and in those addresses only: nothing is written to the browser's storage.
 */

/** The one page a tag is carried to. content/premium.ts › PREMIUM.path says the same; a test holds the two together. */
export const TAGGED_PATH = '/premium/';

/** What the billing service accepts as a tag: lowercase letters, digits, hyphens and underscores. Anything else is no tag. */
export const REF_PATTERN = /^[a-z0-9_-]{1,40}$/;

export function sanitizeRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tag = raw.trim().toLowerCase();
  return REF_PATTERN.test(tag) ? tag : null;
}

function refIn(search: string): string | null {
  return sanitizeRef(new URLSearchParams(search).get('ref'));
}

let arrivedWith: string | null = null;
const listeners = new Set<() => void>();

/** Keeps the tag of the address the visit arrived at (the layout calls it once, on every page). The first tag stays. */
export function rememberEntryRef(search: string): void {
  if (arrivedWith !== null) return;
  arrivedWith = refIn(search);
  if (arrivedWith !== null) for (const listener of listeners) listener();
}

/** The tag the visit arrived with, or null: what a link to /premium/ carries. */
export function entryRef(): string | null {
  return arrivedWith;
}

/** Tells `listener` when the visit's tag becomes known (for `useSyncExternalStore`). Returns the way to stop. */
export function subscribeEntryRef(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A site address with the tag written in, when it leads to /premium/: `/premium/` becomes `/premium/?ref=<tag>`, and
 * an anchor stays after it. Any other address, and any tag that isn't a plain code, comes back as it was: nothing a
 * visitor typed into `?ref=` reaches an href unless it matches REF_PATTERN.
 */
export function withRef(href: string, tag: string | null): string {
  const safe = sanitizeRef(tag);
  if (safe === null) return href;
  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  if (path !== TAGGED_PATH) return href;
  return `${path}?ref=${safe}${hashAt === -1 ? '' : href.slice(hashAt)}`;
}

/** The tag for a quote: the page's own, or the one the visit arrived with. */
export function refFor(search: string): string | null {
  return refIn(search) ?? arrivedWith;
}

/** For tests: a visit that hasn't arrived yet. */
export function forgetEntryRef(): void {
  arrivedWith = null;
  for (const listener of listeners) listener();
}
