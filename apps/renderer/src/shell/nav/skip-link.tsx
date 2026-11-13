// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: skip to content · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.4
 * hidden until it has keyboard focus, then an ink chip with canvas text over the window bar (the rail tooltips' chip)
 * states: default (hidden) · focus (shown, the base ring, instant) · hover · active (pressed: canvas on ink-2)
 *   · disabled, loading, error, success: n/a (a link within the page)
 */
import { Trans } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import type { MouseEvent } from 'react';
import { focusMain } from './lost-focus';

/** The page's main landmark takes focus, so the next Tab goes into the content, not round the bar and sidebar again. */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  focusMain();
}

/**
 * The first stop on every page: Return skips the window bar's controls and
 * the sidebar (eleven to fifteen stops) and lands in the page itself.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={skipToContent}
      data-slot="skip-link"
      className={cn(
        'app-no-drag sr-only rounded-md bg-inverse text-sm font-medium text-on-inverse no-underline active:opacity-90',
        'focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:z-50 focus:-translate-x-1/2 focus:px-3 focus:py-1.5',
      )}
    >
      <Trans>Skip to content</Trans>
    </a>
  );
}
