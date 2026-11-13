// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { llmsFullTxt } from '#lib/llms/llms-txt';

/* route: /llms-full.txt · every page's Markdown mirror in one file. */

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(llmsFullTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
