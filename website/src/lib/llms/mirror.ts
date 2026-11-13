// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { PAGES } from '#content/pages';
import type { PageEntry } from '#content/schema';

/**
 * The Markdown mirror of every listed page, at one scheme: the page's path with `.md` in place of its trailing
 * slash, and `/index.md` for the home page (`/faq/` → `/faq.md`, `/features/agent/` → `/features/agent.md`). The
 * route `app/[...mirror]/route.ts` writes them, llms.txt links them, and each page's head points to its own.
 */
export const MARKDOWN_TYPE = 'text/markdown';

/** Pages that are mirrored and listed: everything in PAGES but the unlisted. */
export function listedPages(): readonly PageEntry[] {
  return PAGES.filter((p) => !p.unlisted);
}

export function mirrorPath(path: string): string {
  return path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`;
}

/** The catch-all route's segments for a page's mirror (`/features/agent/` → `['features', 'agent.md']`). */
export function mirrorSegments(path: string): string[] {
  return mirrorPath(path).slice(1).split('/');
}

/** The page a mirror's segments stand for, or undefined when there is none. */
export function pageForMirror(segments: readonly string[]): PageEntry | undefined {
  const mirror = `/${segments.join('/')}`;
  return listedPages().find((p) => mirrorPath(p.path) === mirror);
}
