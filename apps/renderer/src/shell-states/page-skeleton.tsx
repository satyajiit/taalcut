// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: page skeleton (a code-split page while its code loads) · genre: atmospheric studio app
 * (chrome modern-minimal) · system: DESIGN.md v0.3 + v0.4 (UX1: route pending) · the window bar already names the
 * page where the shell knows it (an area, a Settings section; a detail page's name is a bone after the chevron);
 * the content is the page's bones (page-bones.tsx). Not interactive: no eight states. aria-busy region with one
 * polite "Loading Privacy" for VoiceOver. */
import { useLingui } from '@lingui/react/macro';
import { useRouterState } from '@tanstack/react-router';
import { ToolbarTitle } from '../shell/toolbar';
import { Bone, PageBones } from './page-bones';
import { pagePlace } from './page-place';

/**
 * The page at the current address while its code loads: its name in the window bar when the shell knows it, and
 * its bones in the content. Shown by the router for every code-split page (router.ts defaultPendingComponent).
 */
export function PageSkeleton() {
  const { t, i18n } = useLingui();
  // While a navigation is pending, the router's location is already the new page's.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const place = pagePlace(pathname);
  const name = place.title ? i18n._(place.title) : null;
  return (
    <div
      data-slot="page-skeleton"
      data-shape={place.shape}
      aria-busy="true"
      className="flex min-h-full flex-1"
    >
      {name ? (
        <ToolbarTitle
          // Not the page's heading: the page brings its own h1. The leaving page, still mounted and hidden while
          // this shows, has taken its title out of the bar (shell/toolbar.tsx).
          as="p"
          title={name}
          {...(place.detail ? { detail: <Bone className="h-3.5 translate-y-px" width="9rem" /> } : {})}
        />
      ) : null}
      <span role="status" className="sr-only">
        {name ? t`Loading ${name}` : t`Loading the page`}
      </span>
      <PageBones shape={place.shape} />
    </div>
  );
}
