// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * Hallmark · component: BrowserLink · genre: inline text link (opens a web page in the browser) ·
 * system: DESIGN.md v0.3 (primary-strong text link, underline thickens on hover, the global focus ring) ·
 * states: default, hover (thicker underline), focus-visible (ring), active (browser's), disabled (n/a: a page
 * off core's list shows as plain text, never a dead link), loading (n/a: main opens the page at once),
 * error (toast from useOpenExternal), success (the browser comes forward) ·
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Trans } from '@lingui/react/macro';
import { isExternalLink } from '@taalcut/core';
import { ExternalLink } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useOpenExternal } from './open-external';

const LINK =
  'inline-flex items-center gap-1 font-medium text-primary-strong underline underline-offset-2 hover:decoration-2';

/**
 * A link to a web page (a provider's usage or key page, the beta terms) that opens in the person's browser
 * through main (`files.openExternal`). It stays a real `<a href target="_blank">` so it reads, copies and
 * announces as a link; the click goes through main. A page core doesn't open is plain text: no link.
 */
export function BrowserLink({
  href,
  children,
  size = 'sm',
}: {
  href: string;
  children: ReactNode;
  /** `inherit` takes the surrounding text's size (a sentence's link). */
  size?: 'sm' | 'inherit';
}) {
  const open = useOpenExternal();
  const className = size === 'sm' ? `${LINK} text-sm` : LINK;
  if (!isExternalLink(href))
    return <span className={size === 'sm' ? 'text-sm text-ink-2' : undefined}>{children}</span>;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    open(href);
  };
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} onClick={onClick}>
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">
        <Trans>(opens in your browser)</Trans>
      </span>
    </a>
  );
}
