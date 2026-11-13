// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4
 * Hallmark · component: GitHub links (Star on GitHub · Report issue · Feature request) · genre: atmospheric studio app
 * system: DESIGN.md v0.4 · Settings › About, and Help in the menu and ⌘K (v0.4, UX1: they left the window bar,
 *   which holds Back, Forward, the page's title and the page's own actions)
 * states: default · hover (hover surface, stronger rule) · focus (base ring, instant) · active (pressed surface)
 *   · disabled, loading, error, success: n/a (links that open the browser; main reports a failure)
 * colour: neutral pills; the star is ink-2, not marigold: marigold acts, and nothing here is the page's action
 */
import { Trans } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { Bug, Lightbulb } from 'lucide-react';
import { useCallback, type MouseEvent } from 'react';
import { useOpenExternal } from '../chat/open-external';

export const GITHUB_REPO_URL = 'https://github.com/satyajiit/taalcut';
export const GITHUB_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?template=bug.yml`;
export const GITHUB_FEATURE_URL = `${GITHUB_REPO_URL}/issues/new?template=feature_request.yml`;

const GITHUB_MARK_PATH =
  'M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2.16 2.16 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.1-2.84a3.76 3.76 0 010-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 010 2.93c.73.74 1.1 1.74 1.1 2.84 0 4.31-2.57 5.23-5.04 5.4.45.37.82.92.82 2.02v3.03c0 .27.18.64.73.55A11 11 0 0012 1.27';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={cn('size-3.5 shrink-0', className)}>
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

/**
 * Opens a GitHub page in the person's browser through main (`files.openExternal`): a window can't open a new
 * window, so a plain `target=_blank` would do nothing in the app. The anchor keeps its href, so it still reads,
 * copies and announces as a link.
 */
export function useOpenOnClick(): (href: string) => (event: MouseEvent<HTMLAnchorElement>) => void {
  const open = useOpenExternal();
  return useCallback(
    (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      open(href);
    },
    [open],
  );
}

/** Full-label GitHub Star, Issue, and Feature Request CTAs for Settings › About. */
export function GitHubAboutLinks({ className }: { className?: string }) {
  const openOnClick = useOpenOnClick();
  const pillClass = cn(
    'inline-flex h-8 items-center gap-2 rounded-lg border border-rule bg-control px-3 text-sm font-medium whitespace-nowrap text-ink no-underline',
    'transition-[background-color,border-color,color] duration-(--dur-micro) ease-(--ease-out)',
    'hover:border-rule-strong hover:bg-control-hover active:bg-control-pressed',
  );
  return (
    <div data-slot="github-about-links" className={cn('flex flex-wrap items-center gap-2', className)}>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        onClick={openOnClick(GITHUB_REPO_URL)}
        className={pillClass}
      >
        <GitHubIcon className="text-ink-2" />
        <Trans>Star on GitHub</Trans>
      </a>
      <a
        href={GITHUB_ISSUE_URL}
        target="_blank"
        rel="noreferrer"
        onClick={openOnClick(GITHUB_ISSUE_URL)}
        className={pillClass}
      >
        <Bug aria-hidden className="size-3.5 shrink-0 text-ink-2" />
        <Trans>Report issue</Trans>
      </a>
      <a
        href={GITHUB_FEATURE_URL}
        target="_blank"
        rel="noreferrer"
        onClick={openOnClick(GITHUB_FEATURE_URL)}
        className={pillClass}
      >
        <Lightbulb aria-hidden className="size-3.5 shrink-0 text-ink-2" />
        <Trans>Feature request</Trans>
      </a>
    </div>
  );
}
