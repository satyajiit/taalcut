// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: inline text · content strings with `[label](href)` links and `code` (a storage key, a file name), as
 * src/content writes them for the pages and the .md mirrors alike. mode: Read · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2
 * states: link default (ink, rule-strong underline) · hover (underline to ink) · focus (base ring) · visited (same)
 * A link in running text wraps with its sentence, so a long label never pushes the page sideways at 320 px. */

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { cn } from '#lib/cn';

/** A `[label](href)` link, or a `code` span. */
const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

export const INLINE_LINK_CLASS =
  'text-ink underline decoration-rule-strong decoration-1 underline-offset-4 ' +
  'transition-[text-decoration-color] duration-(--dur-micro) ease-(--ease-out) hover:decoration-ink';

/** One link: a site path through next/link, a mail link or an anchor on the page as is, anything else in a new tab. */
export function InlineLink({ href, children, className }: { readonly href: string; readonly children: ReactNode; readonly className?: string }) {
  const cls = cn(INLINE_LINK_CLASS, className);
  if (href.startsWith('/')) {
    return (
      // Paths in content are checked against PAGES by the geo tests.
      <Link href={href as never} className={cls}>
        {children}
      </Link>
    );
  }
  if (href.startsWith('mailto:') || href.startsWith('#')) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Content text with its links made live and its code set in the mono face. */
export function InlineText({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      m[3] !== undefined ? (
        <code key={at} className="font-mono text-ink [overflow-wrap:anywhere]">
          {m[3]}
        </code>
      ) : (
        <InlineLink key={at} href={m[2]!}>
          {m[1]}
        </InlineLink>
      ),
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
