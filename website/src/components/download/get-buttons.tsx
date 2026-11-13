// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: get buttons · the site's two actions, side by side: Download for Mac and GitHub
 * mode: Persuade · system: WEB2 Remix Vernacular (One Marigold Rule: Download for Mac is its screen's one marigold
 *   fill; GitHub is a secondary button with GitHub's own SVGL icon beside its name)
 * states: each link default · hover (marigold-hover / control-hover) · focus (base ring) · active (2 % give); nothing
 *   to disable, load or fail: both are plain links, so they work without JavaScript. Download for Mac is the .dmg
 *   itself on the release (content/release.ts) and opens in place; GitHub opens the repository in a new tab.
 * Under them, the note says the version and what it needs, and `limit` adds the release's one known limit in words.
 * `tone="quiet"` is for a second pair on a screen that already has its marigold: both buttons secondary. */

import { ArrowDownToLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { buttonClasses } from '#components/ui/button-classes';
import { KNOWN_LIMIT, GET, RELEASE } from '#content/release';
import { SITE } from '#content/site';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

export function DownloadLink({
  quiet = false,
  className,
}: {
  readonly quiet?: boolean;
  readonly className?: string;
}) {
  return (
    <a
      href={RELEASE.download}
      data-slot="download-link"
      className={buttonClasses(quiet ? 'secondary' : 'primary', 'lg', className)}
    >
      <ArrowDownToLine aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
      {GET.download}
    </a>
  );
}

export function GitHubLink({ className }: { readonly className?: string }) {
  return (
    <a
      href={SITE.repository}
      data-slot="github-link"
      rel="noopener noreferrer"
      target="_blank"
      className={buttonClasses('secondary', 'lg', className)}
    >
      <BrandIcon id="github" className="size-4" />
      {GET.github}
    </a>
  );
}

export interface GetButtonsProps {
  /** `quiet`: both secondary, for a screen whose marigold is already taken. */
  readonly tone?: 'primary' | 'quiet';
  /** Say the known limit under the note. */
  readonly limit?: boolean;
  /** Anything else under the note (the hero's link to /download/). */
  readonly children?: ReactNode;
  readonly className?: string;
}

export function GetButtons({ tone = 'primary', limit = false, children, className }: GetButtonsProps) {
  return (
    <div data-slot="get-taalcut" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-3">
        <DownloadLink quiet={tone === 'quiet'} />
        <GitHubLink />
      </div>
      <p className="m-0 type-body text-ink-2">{GET.note}</p>
      {limit ? <p className="m-0 max-w-[36em] type-body text-pretty text-ink-2">{KNOWN_LIMIT}</p> : null}
      {children}
    </div>
  );
}
