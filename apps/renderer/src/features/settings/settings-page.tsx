// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a settings page (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the shell's Page, with Settings' one rhythm under it: the page's tip (a PageTip, at most one), then its sections
 *   (the kit's PageSection, level 2) 40 px apart, whatever stands between them (a notice, a skeleton, an empty
 *   state), so a page reads as its parts and a notice never changes the gaps around it
 * states: n/a (a frame; its sections carry theirs) */
import { cn, ViewLink, ViewLinks, type IconLike } from '@taalcut/ui';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { Page, type PageProps } from '../../shell/page';

export interface SettingsPageProps extends PageProps {
  /** The page's first-visit tip (a PageTip), above its sections. */
  tip?: ReactNode;
}

/**
 * The frame of every settings page. Sections stack in one column 40 px apart: the column sets the gap, so the
 * kit's own sibling margin is held at 0 here, and a notice or a skeleton between two sections keeps the rhythm.
 */
export function SettingsPage({ tip, children, className, ...page }: SettingsPageProps) {
  return (
    <Page {...page}>
      {tip}
      <div
        data-slot="settings-page"
        className={cn('flex min-w-0 flex-col gap-10 [&>[data-slot=page-section]]:mt-0!', className)}
      >
        {children}
      </div>
    </Page>
  );
}

export interface SettingsViewItem {
  /** The view's id, to say which is current. */
  id: string;
  /** Its name. */
  label: string;
  /** Its glyph (settings-icons.ts). */
  icon: IconLike;
  /** The router's link to it, with its name as its child. */
  link: ReactElement;
}

/**
 * A settings page's views (UX4): the kit's ViewLinks in Page's `views` slot, each its own page with its own URL, so
 * Back, the crumbs and ⌘[ work, and the sidebar's section stays current on every one of them.
 */
export function SettingsViews({
  label,
  current,
  views,
}: {
  /** The views' name: the section's ("Usage", "Accounts"). */
  label: string;
  current: string;
  views: readonly SettingsViewItem[];
}) {
  return (
    <ViewLinks label={label} data-slot="settings-views">
      {views.map((view) => (
        <ViewLink key={view.id} asChild current={view.id === current} icon={view.icon}>
          {/* Only the view open is current: the router would also mark the section's first view (its parent path). */}
          {cloneElement(view.link as ReactElement<{ activeOptions?: { exact: boolean } }>, {
            activeOptions: { exact: true },
          })}
        </ViewLink>
      ))}
    </ViewLinks>
  );
}
