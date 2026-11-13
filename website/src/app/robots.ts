// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { MetadataRoute } from 'next';
import { robotsRules } from '#lib/llms/crawlers';

/* route: /robots.txt · everything allowed, the AI crawlers named and allowed, the sitemap linked. */

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return robotsRules();
}
