// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { MetadataRoute } from 'next';
import { CONTENT_UPDATED } from '#content/llms';
import { listedPages } from '#lib/llms/mirror';
import { absolute } from '#lib/seo';

/* route: /sitemap.xml · every listed page in PAGES, with when the site's words last changed. */

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return listedPages().map((p) => ({
    url: absolute(p.path),
    lastModified: CONTENT_UPDATED,
    priority: p.path === '/' ? 1 : p.section === 'Legal' ? 0.3 : 0.7,
  }));
}
