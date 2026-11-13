// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { uiCommandShortcut, type WindowState } from '@taalcut/core';
import {
  Button,
  naturalTitleLeft,
  publishShellGrid,
  SIDEBAR_WIDTH,
  ShortcutKeys,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  WindowBar,
  WindowControls,
  useKeyboard,
  useShortcutFormat,
  useWindowControlsOverlay,
} from '@taalcut/ui';
import { useRouterState } from '@tanstack/react-router';
import { PanelLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { AnalysisIndicator } from '../features/analysis/analysis-indicator';
import { DownloadsIndicator } from '../features/downloads/downloads-indicator';
import { useServices } from '../services/provider';
import { HistoryButtons } from './nav/history-buttons';
import { useHistoryKeys } from './nav/history-keys';
import { useLostFocus } from './nav/lost-focus';
import { pageAnswersMouseButtons, useMouseHistory } from './nav/pointer-history';
import { useProjectsAction } from './nav/projects-action';
import { useScrollMemory } from './nav/scroll-memory';
import { SkipLink } from './nav/skip-link';
import { useHistoryLedger } from './nav/use-history-nav';
import { SIDEBAR_ID, toggleSidebar, useSidebarCollapsed, useSidebarShown } from './sidebar-state';
import type { WindowClient } from './window-client';

/** The window's state as main reports it; null in a plain browser (no window behind the page). */
function useWindowState(client: WindowClient | null): WindowState | null {
  const [state, setState] = useState<WindowState | null>(null);
  useEffect(() => client?.watch(setState), [client]);
  return state;
}

/**
 * html[data-window-active]: whether this is the window in front. Electron:
 * from main (BrowserWindow focus and blur). A plain browser: from the page's
 * own focus and blur, starting active.
 */
function useWindowActive(client: WindowClient | null, focused: boolean | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    if (client) {
      root.dataset.windowActive = String(focused ?? true);
      return;
    }
    const set = (active: boolean) => () => void (root.dataset.windowActive = String(active));
    const onFocus = set(true);
    const onBlur = set(false);
    onFocus();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [client, focused]);
}

/** Folds the sidebar to its icon rail and opens it again. Its name stays "Sidebar"; aria-expanded says which. */
function SidebarButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useLingui();
  const label = collapsed ? t`Expand sidebar` : t`Collapse sidebar`;
  const shortcut = useShortcutFormat();
  // Core's view.sidebar binding, the menu's and ⌘K's: ⌃⌘S on a Mac, Ctrl+B on a PC.
  const accelerator = uiCommandShortcut('view.sidebar', useKeyboard()) ?? '';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Sidebar`}
          aria-expanded={!collapsed}
          aria-controls={SIDEBAR_ID}
          aria-keyshortcuts={shortcut.aria(accelerator)}
          className="size-7 window-inactive:text-ink-3"
          onClick={toggleSidebar}
        >
          <PanelLeft aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        <ShortcutKeys accelerator={accelerator} />
      </TooltipContent>
    </Tooltip>
  );
}

export interface AppWindowBarProps {
  titleSlot: Ref<HTMLDivElement>;
  actionsSlot: Ref<HTMLDivElement>;
}

/**
 * The bar's side of the page grid (shell/page.tsx): where the page area starts (the sidebar's width) and where the
 * title stands after Back, Forward and the mark (which travels with it, just before it). Its layout effect runs before the bar's own (it comes first in the
 * tree), so when the sidebar folds, the title's slide already ends on the new column. `layout` lists what else
 * moves the title: full screen, the system's controls, onboarding.
 */
function ShellGrid({ sidebar, layout }: { sidebar: 'open' | 'rail' | null; layout: string }) {
  useLayoutEffect(() => {
    const bar = '[data-slot=window-bar][data-grid]';
    const heading = document.querySelector<HTMLElement>(`${bar} [data-slot=window-bar-heading]`);
    const title = document.querySelector<HTMLElement>(`${bar} [data-slot=window-bar-title]`);
    publishShellGrid({
      shellStart: sidebar === null ? 0 : SIDEBAR_WIDTH[sidebar],
      titleStart: heading && title ? naturalTitleLeft(heading, title) : 0,
    });
  }, [sidebar, layout]);
  return null;
}

/**
 * The window bar on every route (DESIGN.md, "Window"): our traffic controls
 * on main's window (on Linux and Windows the system's, overlaid on the bar's
 * right end, and none of ours), the sidebar button on the app's pages, Back and Forward,
 * and the page's title and actions, which pages portal into the slots
 * (ToolbarTitle, ToolbarActions), then the models' download while it runs. In a plain browser the controls
 * are inert.
 * It also keeps each page's place across Back and Forward, gives the page focus when
 * a navigation takes away what had it, and answers the mouse's side buttons.
 */
export function AppWindowBar({ titleSlot, actionsSlot }: AppWindowBarProps) {
  const { window: client } = useServices();
  const state = useWindowState(client);
  useWindowActive(client, state?.focused);
  const ledger = useHistoryLedger();
  useHistoryKeys(ledger);
  useMouseHistory(ledger, pageAnswersMouseButtons(client !== null, navigator.userAgent));
  useScrollMemory();
  useLostFocus();
  useProjectsAction();
  // The band and the sidebar button go with the sidebar (not on onboarding, nor on a page that failed).
  const inShell = useSidebarShown();
  // Onboarding shows the full four-colour logo under the bar: no second mark beside its name.
  const onboarding = useRouterState({
    select: (s) => s.matches.some((match) => match.routeId === '/onboarding'),
  });
  const collapsed = useSidebarCollapsed();
  const fullScreen = state?.fullScreen ?? false;
  // Linux and Windows: the system draws the window's controls over the bar (apps/desktop platform/frame.ts).
  const systemControls = useWindowControlsOverlay();
  // The band folds with the sidebar; when the shell itself comes or goes (onboarding), it just changes.
  const wasInShell = useRef(inShell);
  const fold = wasInShell.current === inShell;
  useEffect(() => {
    wasInShell.current = inShell;
  }, [inShell]);
  return (
    <>
      <ShellGrid
        sidebar={inShell ? (collapsed ? 'rail' : 'open') : null}
        layout={`${fullScreen} ${systemControls} ${onboarding}`}
      />
      <SkipLink />
      <WindowBar
        grid
        leadWidth={inShell && !collapsed ? 'sidebar' : 'inset'}
        foldAnimation={fold}
        fullScreen={fullScreen}
        systemControls={systemControls}
        controls={
          <WindowControls
            edited={state?.edited ?? false}
            fullScreen={fullScreen}
            {...(client ? { onAction: (action, options) => client.act(action, options) } : {})}
          />
        }
        lead={inShell ? <SidebarButton collapsed={collapsed} /> : null}
        // Onboarding has neither: its steps carry their own Back and Continue, and it shows the full logo.
        mark={!onboarding}
        nav={onboarding ? null : <HistoryButtons />}
        titleSlot={titleSlot}
        actionsSlot={actionsSlot}
        // The download of everything this Mac needs, on every page in the shell (UX2-DOWNLOADER). First run's
        // rail has its own line.
        end={
          inShell ? (
            <>
              <AnalysisIndicator />
              <DownloadsIndicator />
            </>
          ) : null
        }
        {...(client ? { onDoubleClick: () => void client.doubleClick() } : {})}
      />
    </>
  );
}
