// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FEATURES } from '#content/features';
import { ogImage } from '#lib/og/card';

/* route: each feature's social card (lane L6, system: WEB2 Remix Vernacular; drawn by lib/og/card at build: the reel frame, its segment bar and the page's sticker). A static export needs the segment's
 * params here too, so it lists the same slugs as the page. */

export const dynamic = 'force-static';
export const dynamicParams = false;
export const alt = 'A Taalcut feature';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return ogImage(`/features/${slug}/`);
}
