// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { listedPages, mirrorSegments, pageForMirror } from '#lib/llms/mirror';
import { pageMarkdown } from '#lib/llms/pages-md';

/* route: the .md mirrors (/index.md, /faq.md, /features/agent.md …) · one per listed page, exported as files.
 * Only the listed mirrors exist (dynamicParams = false); any other address is the 404. */

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { mirror: string[] }[] {
  return listedPages().map((p) => ({ mirror: mirrorSegments(p.path) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ mirror: string[] }> }): Promise<Response> {
  const { mirror } = await params;
  const entry = pageForMirror(mirror);
  if (!entry) return new Response('Not found', { status: 404 });
  return new Response(pageMarkdown(entry), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
