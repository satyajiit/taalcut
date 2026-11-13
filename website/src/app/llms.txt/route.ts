// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { llmsTxt } from '#lib/llms/llms-txt';

/* route: /llms.txt · the site's map for language models (llmstxt.org), generated from PAGES and src/content. */

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(llmsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
