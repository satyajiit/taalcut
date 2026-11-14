// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: ref link · a site link that carries the visit's tag to /premium/ (`/premium/?ref=producthunt`)
 * mode: Read · system: WEB2 Remix Vernacular
 * states: the link's own, given by its `className` (default · hover · focus · active · visited). The server HTML has
 *   the plain address; once the visit's tag is known the href gains it, so opening the link in a new tab, or
 *   reloading /premium/ after following it, still asks for the price with the tag.
 * Only a link whose path is /premium/ changes, and only a tag that is a plain code is ever written into an href
 * (lib/billing/ref › withRef). Nothing is stored: the tag lives in memory and in these addresses. */

import Link from 'next/link';
import { type ComponentProps, useSyncExternalStore } from 'react';
import { entryRef, subscribeEntryRef, withRef } from '#lib/billing/ref';

const none = (): null => null;

/** The tag this visit arrived with, once the page knows it (null in the server HTML and before). */
export function useEntryRef(): string | null {
  return useSyncExternalStore(subscribeEntryRef, entryRef, none);
}

/** A site address with the visit's tag, when it leads to /premium/. */
export function useRefHref(href: string): string {
  return withRef(href, useEntryRef());
}

export function RefLink({
  href,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href'> & { readonly href: string }) {
  // Paths in content are checked against PAGES by the geo tests; the tag is a query, never a new route.
  return <Link href={useRefHref(href) as never} {...rest} />;
}
