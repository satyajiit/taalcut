// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: settings route shell & left-side tabs sidebar · genre: atmospheric studio app · system: DESIGN.md v0.6 + UX4
 * Dedicated /settings route with its own left-side tab navigation, back-to-app link, ⌘K command bar, and theme controls.
 * Supports ⌃⌘S (Ctrl+B on a PC) rail folding and window-bar alignment via FoldingPanel + FoldShift.
 * UX4 (set lane): the sections by task in four groups (shell/settings-sections.ts), General first with no heading;
 *   group headings take type-caption in their own case (uppercase does nothing for Hindi); a section stays current
 *   on its own sub-pages and on the pages it stands for (General: Updates, This Mac, About). */

import { useLingui } from '@lingui/react/macro';
import {
  cn,
  FoldFade,
  FoldShift,
  RailTooltipGroup,
  ScrollArea,
  Separator,
  useSidebarFold,
} from '@taalcut/ui';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Fragment, useEffect } from 'react';
import { isUnder } from '../../shell/areas';
import { NavItem } from '../../shell/nav-item';
import { useLeaveSettings } from '../../shell/nav/leave-settings';
import { SCROLL_HINT_CLASS, useScrollHint } from '../../shell/scroll-hint';
import { useGroupsGlide } from '../../shell/settings-glide';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../../shell/settings-sections';
import { CommandsRow, FoldingPanel, ThemeRow } from '../../shell/sidebar';
import { useSidebarMounted } from '../../shell/sidebar-state';

export const Route = createFileRoute('/settings')({
  component: SettingsShell,
});

/**
 * Settings' sections, by group. Rendered inside the folding panel, so `rail` is the panel's own fold: read above
 * it, the context is the default (always open), and the headings kept their room on the rail as a column of
 * letters about 100 px tall each, which pushed Usage and About under the fold at 1024 × 720. On the rail a
 * hairline stands between the groups where their headings stand when open; the groups glide between the two
 * (settings-glide.ts). Ten rows and three hairlines fit 960 × 600 on the rail with 2 px either side of a hairline;
 * at 4 px they would fill the list to the last pixel.
 */
function SettingsSections() {
  const { t, i18n } = useLingui();
  const { rail } = useSidebarFold();
  const pathname = useLocation({ select: (location) => location.pathname });
  const hint = useScrollHint<HTMLElement>();
  useGroupsGlide(hint.ref, rail);
  // In a short window (960 × 600) the sections scroll on their own, with the scroll hint's fade; the open one is
  // brought into view, so a section below the fold (Usage, About) is never current out of sight. (jsdom has no
  // scrollIntoView.)
  useEffect(() => {
    hint.ref.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [hint.ref, pathname]);

  return (
    <nav
      ref={hint.ref}
      aria-label={t`Settings`}
      data-more={hint.more}
      className={cn(
        '-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 scrollbar-thin',
        // Tighter on the rail, with the hairlines: all ten sections fit the smallest window (960 × 600).
        rail ? 'gap-0.5' : 'gap-3',
        SCROLL_HINT_CLASS,
      )}
    >
      {SETTINGS_GROUPS.map((group, index) => {
        const items = SETTINGS_SECTIONS.filter((section) => section.group === group.id);
        return (
          <Fragment key={group.id}>
            {rail && index > 0 ? (
              <Separator data-group-rule data-glide={`rule-${group.id}`} className="opacity-60" />
            ) : null}
            <div data-glide={group.id} className="flex flex-col gap-0.5">
              {group.title ? (
                <FoldFade className={cn(rail && 'hidden')}>
                  <h2 className="m-0 px-2.5 pb-1 type-caption text-ink-3">{i18n._(group.title)}</h2>
                </FoldFade>
              ) : null}
              {items.map((section) => (
                <NavItem
                  key={String(section.to)}
                  to={section.to}
                  icon={section.icon}
                  label={i18n._(section.label)}
                  active={isUnder(pathname, [String(section.to), ...(section.also ?? [])])}
                />
              ))}
            </div>
          </Fragment>
        );
      })}
    </nav>
  );
}

function SettingsSidebar() {
  const { t } = useLingui();
  useSidebarMounted();
  const dev = import.meta.env.DEV;
  // Back to app returns to the page Settings was opened from (shell/nav/leave-settings.ts).
  const leaveSettings = useLeaveSettings();

  return (
    <FoldingPanel label={t`Sidebar`}>
      <RailTooltipGroup>
        {/* The main sidebar's rhythm (shell/sidebar.tsx): rows 2 px apart, 12 px between the blocks. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 pt-2 pb-3">
          <nav aria-label={t`App`} className="flex flex-col gap-0.5">
            <NavItem
              to="/chat"
              icon={ArrowLeft}
              label={t`Back to app`}
              active={false}
              onClick={leaveSettings}
              className="text-ink-2 hover:text-ink"
            />
            <CommandsRow />
          </nav>

          <Separator className="opacity-60" />

          <SettingsSections />

          <div className="flex flex-col gap-1.5">
            <Separator className="opacity-60" />
            <ThemeRow dev={dev} />
          </div>
        </div>
      </RailTooltipGroup>
    </FoldingPanel>
  );
}

/**
 * Full dedicated Settings route shell: left-side Settings tabs sidebar and
 * scrollable settings canvas on the right.
 */
function SettingsShell() {
  return (
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <SettingsSidebar />
      <FoldShift className="flex min-w-0 flex-1">
        <ScrollArea className="flex-1">
          <main id="main" className="flex min-h-full flex-col focus:outline-none">
            <Outlet />
          </main>
        </ScrollArea>
      </FoldShift>
    </div>
  );
}
