// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5
 * Hallmark · component: app sidebar (open, and folded to an icon rail) · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the same rows in the same places either way: open, icon and word; on the 56 px rail, the icon with its name in a
 *   tooltip. Recent chats and the words fold away; New chat, the areas, ⌘K, Settings and the theme toggle stay,
 *   the toggle in the same spot open and folded. Settings opens its own dedicated route with its own left-side tabs.
 * motion: the fold (SidebarPanel, on the compositor), the current row's gliding mark, gliding hover mark, and icon tick (NavItem);
 *   a press gives the row by 2 % (UX4). Kaatu, the companion, sits at the foot (features/kaatu/companion.tsx).
 * states: the rows' (NavItem, Commands: default · hover · focus · active · current); the theme toggle's (ThemeToggle)
 */
import { useLingui } from '@lingui/react/macro';
import {
  cn,
  FoldFade,
  FoldLabel,
  HoverIndicator,
  RailTooltip,
  RailTooltipGroup,
  Separator,
  ShortcutKeys,
  SidebarPanel,
  ThemeToggle,
  useSidebarFold,
  useThemeToggleLabel,
  useShortcutFormat,
} from '@taalcut/ui';
import { useLocation } from '@tanstack/react-router';
import { Activity, Blocks, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { Companion } from '../features/kaatu/companion';
import { setPaletteOpen } from '../features/palette/palette-state';
import { AREAS, isUnder } from './areas';
import { LocaleSwitcher } from './locale-switcher';
import { NAV_ITEM_CLASS, NavItem, RAIL_ITEM_CLASS } from './nav-item';
import { RecentChats } from './recent-chats';
import { SIDEBAR_ID, useSidebarCollapsed, useSidebarMounted } from './sidebar-state';

const PALETTE_SHORTCUT = 'mod+k';
const SETTINGS_SHORTCUT = 'mod+,';

/** ⌘K: a row with its shortcut when open, the magnifier on the rail. */
export function CommandsRow() {
  const { t } = useLingui();
  const { rail } = useSidebarFold();
  const shortcut = useShortcutFormat();
  const label = t`Commands`;
  return (
    <RailTooltip label={label} shortcut={PALETTE_SHORTCUT} disabled={!rail}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts={shortcut.aria(PALETTE_SHORTCUT)}
        onClick={() => setPaletteOpen(true)}
        className={cn(NAV_ITEM_CLASS, 'w-full cursor-pointer text-left', rail && RAIL_ITEM_CLASS)}
      >
        <HoverIndicator scope="sidebar" />
        <Search
          aria-hidden
          className="relative size-4 shrink-0 text-ink-3 transition-colors duration-(--dur-micro) group-hover/row:text-ink-2"
        />
        <FoldLabel className="relative flex-1">{label}</FoldLabel>
        <FoldFade className={cn('relative shrink-0', rail && 'hidden')}>
          <ShortcutKeys accelerator={PALETTE_SHORTCUT} />
        </FoldFade>
      </button>
    </RailTooltip>
  );
}

/** The theme: a quiet row when open, and an icon button on the rail. */
export function ThemeRow({ dev }: { dev: boolean }) {
  const label = useThemeToggleLabel();
  const { rail } = useSidebarFold();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <RailTooltip label={label} disabled={!rail} className={cn(!rail && 'w-full')}>
          <ThemeToggle showLabel={!rail} className={cn(rail && cn(RAIL_ITEM_CLASS, 'h-[2.125rem]'))} />
        </RailTooltip>
      </div>
      {dev ? (
        <FoldFade className={cn('flex justify-end px-1', rail && 'hidden')}>
          <LocaleSwitcher />
        </FoldFade>
      ) : null}
    </div>
  );
}

/**
 * The panel alone follows the fold, so folding re-renders it and not the rows
 * inside (the rows change only when the rail settles, after the movement).
 */
export function FoldingPanel({ label, children }: { label: string; children: ReactNode }) {
  const collapsed = useSidebarCollapsed();
  return (
    <SidebarPanel id={SIDEBAR_ID} collapsed={collapsed} aria-label={label}>
      {children}
    </SidebarPanel>
  );
}

/**
 * The main workspace sidebar: ⌘K, the four studio areas, recent chats, and the
 * footer with Settings (⌘,) and the theme switcher. View › Toggle Sidebar (⌃⌘S;
 * Ctrl+B on a PC) folds it to the 56 px icon rail.
 */
export function Sidebar() {
  const { t, i18n } = useLingui();
  const pathname = useLocation({ select: (location) => location.pathname });
  useSidebarMounted();
  const dev = import.meta.env.DEV;

  return (
    <FoldingPanel label={t`Sidebar`}>
      <RailTooltipGroup>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-2 pt-2 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <CommandsRow />
            <nav aria-label={t`Areas`} className="flex min-w-0 flex-col gap-0.5">
              {AREAS.map((area) => (
                <NavItem
                  key={area.id}
                  to={area.to}
                  icon={area.icon}
                  iconClass={area.iconClass}
                  label={i18n._(area.label)}
                  active={isUnder(pathname, area.paths)}
                />
              ))}
            </nav>
          </div>

          <Separator className="opacity-60" />

          {/* 4 px into the sidebar's padding on each side, so focus rings in the scrolling list aren't cut off. */}
          <div className="-mx-1 flex min-h-0 min-w-0 flex-1 flex-col">
            <RecentChats className="flex-1" />
          </div>

          <div className="flex flex-col gap-1.5">
            {/* Kaatu sits on the hairline above Settings, on the rows' icon column, open or on the rail. */}
            <Companion className="-mb-1.5" />
            <Separator className="opacity-60" />
            <nav aria-label={t`App`} className="flex flex-col gap-0.5">
              <NavItem
                to="/settings"
                icon={Settings}
                label={t`Settings`}
                shortcut={SETTINGS_SHORTCUT}
                active={false}
                exact
              />
              {dev ? (
                <>
                  <NavItem
                    to="/dev/traces"
                    icon={Activity}
                    label={t`Traces`}
                    active={isUnder(pathname, ['/dev/traces'])}
                  />
                  <NavItem
                    to="/dev/kit"
                    icon={Blocks}
                    label={t`UI kit`}
                    active={isUnder(pathname, ['/dev/kit'])}
                  />
                </>
              ) : null}
            </nav>
            <ThemeRow dev={dev} />
          </div>
        </div>
      </RailTooltipGroup>
    </FoldingPanel>
  );
}
