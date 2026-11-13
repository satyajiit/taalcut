// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Metadata } from 'next';
import { page } from '#content/pages';
import { SITE } from '#content/site';
import { MARKDOWN_TYPE, mirrorPath } from './llms/mirror';

/** The absolute URL of a site path. */
export function absolute(path: string): string {
  return new URL(path, SITE.origin).toString();
}

/**
 * The social card's site-wide fields. Next replaces a parent's `openGraph` and `twitter` wholesale when a page sets
 * its own, so every page spreads these back in (otherwise a page loses og:type, og:site_name and the large card).
 */
export const SOCIAL = {
  openGraph: { siteName: SITE.name, type: 'website', locale: 'en' },
  twitter: { card: 'summary_large_image' },
} as const satisfies Pick<Metadata, 'openGraph' | 'twitter'>;

/**
 * The site-wide defaults: the title template, icons, manifest and the social card. No `robots`: pages are indexable
 * by default, and the 404 gets exactly one robots meta, the `noindex` Next writes for a not-found page.
 */
export function rootMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE.origin),
    title: { default: `${SITE.name}`, template: `%s · ${SITE.name}` },
    description: SITE.description,
    applicationName: SITE.name,
    icons: {
      icon: [
        { url: '/brand/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: '/brand/apple-touch-icon.png',
    },
    manifest: '/manifest.webmanifest',
    openGraph: { ...SOCIAL.openGraph },
    twitter: { ...SOCIAL.twitter },
    formatDetection: { telephone: false, address: false, email: false },
  };
}

/**
 * A page's metadata from its PAGES entry: title, description, canonical, its Markdown mirror and the social card's words. The OG image
 * comes from the route's opengraph-image (lane L4), which Next links on its own.
 */
export function pageMetadata(path: string): Metadata {
  const entry = page(path);
  const title = path === '/' ? { absolute: entry.title } : entry.title;
  const unlisted = entry.unlisted === true;
  return {
    title,
    description: entry.description,
    alternates: { canonical: path, ...(unlisted ? {} : { types: { [MARKDOWN_TYPE]: mirrorPath(path) } }) },
    openGraph: { ...SOCIAL.openGraph, title: entry.title, description: entry.description, url: path },
    twitter: { ...SOCIAL.twitter, title: entry.title, description: entry.description },
  };
}
