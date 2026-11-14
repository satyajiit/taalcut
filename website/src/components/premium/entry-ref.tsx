// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: entry ref · keeps the tag a link brought this visit with (`?ref=producthunt`), for /premium/'s quote
 * mode: Read · system: WEB2 Remix Vernacular
 * states: none. It renders nothing and is not a control. The layout mounts it once, so the tag of the page a visit
 * arrived at is still known when the visitor reaches /premium/ inside the site. In memory only (lib/billing/ref):
 * nothing is written to the browser's storage, and nothing is sent anywhere until /premium/ asks for its price. */

import { useEffect } from 'react';
import { rememberEntryRef } from '#lib/billing/ref';

export function EntryRef() {
  useEffect(() => {
    rememberEntryRef(window.location.search);
  }, []);
  return null;
}
