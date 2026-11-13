// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ogImage } from '#lib/og/card';

/* route: the social card for /features/ (lane L6, system: WEB2 Remix Vernacular; drawn by lib/og/card at build: the reel frame, its segment bar and the page's sticker). */

export const dynamic = 'force-static';
export const alt = 'Taalcut features';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return ogImage('/features/');
}
