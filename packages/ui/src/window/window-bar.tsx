// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: window bar (unified toolbar) · genre: atmospheric studio app · theme: custom "golden hour, on the beat" (DESIGN.md v0.2)
 * states: a container, not a control. Its own: active window · inactive window · full screen · beside the sidebar · alone.
 *   Its controls carry the eight (window-controls.tsx; the sidebar button is a Button).
 * motion: the band folds with the sidebar (its colour narrows to the rail and fades, the sidebar button, Back and
 *   Forward and the title slide, each its own distance), on the sidebar's fold clock: the same frame, time and ease;
 *   transform and opacity on the Web Animations API. Nothing else moves.
 * layout (UX4): the page grid (page-grid.css). With `grid`, the title sits on the page's column and the page's
 *   actions end on it, from the same numbers the page uses; the bar's own end (the analysis count, the download)
 *   keeps what it measures, plus 20 px (useEndRoom; 3rem until measured).
 *   The Avartan mark travels with the title: Back and Forward stay at the bar's start, and the mark sits just before
 *   the title (or its first crumb), hanging into the gutter, so the title's words start on the column's edge.
 * contrast: pass (46–50)
 */
import { ChevronRight } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '#lib/cn';
import { FOLD_DISTANCE, SIDEBAR_WIDTH } from '#lib/motion';
import { foldTo, playFold, stopFold } from '../sidebar/fold-clock';
import { FoldFlip } from '../sidebar/fold-flip';
import { AvartanMark } from './avartan-mark';

/** The band's parts at fold progress p (0 beside the open sidebar, 1 beside the rail). */
const bandAt = (p: number) => ({
  transform: `scaleX(${1 - (FOLD_DISTANCE / SIDEBAR_WIDTH.open) * p})`,
  opacity: 1 - p,
});
const edgeAt = (p: number) => ({
  transform: `translateX(${SIDEBAR_WIDTH.open - 1 - FOLD_DISTANCE * p}px)`,
  opacity: 1 - p,
});
const floorAt = (p: number) => ({ opacity: p });

/** The band folds with the sidebar: each part from where the fold was to where it ends. */
function useBandFold(sidebar: boolean, enabled: boolean) {
  const band = useRef<HTMLSpanElement>(null);
  const edge = useRef<HTMLSpanElement>(null);
  const floor = useRef<HTMLSpanElement>(null);
  const was = useRef(sidebar);
  useLayoutEffect(() => {
    if (was.current === sidebar) return;
    was.current = sidebar;
    const parts = [
      [band.current, bandAt],
      [edge.current, edgeAt],
      [floor.current, floorAt],
    ] as const;
    if (!enabled) {
      for (const [el] of parts) if (el) stopFold(el);
      return;
    }
    const fold = foldTo(!sidebar);
    for (const [el, at] of parts) if (el) playFold(el, [at(fold.from), at(fold.to)], fold);
  }, [sidebar, enabled]);
  return { band, edge, floor };
}

/**
 * What sits on the left of the bar: the sidebar's top band (the sidebar's
 * width and colour, so the sidebar reads as one column up to the top edge),
 * or just the band the traffic controls need.
 */
export type WindowBarLead = 'sidebar' | 'inset';

export interface WindowBarProps {
  /** The traffic controls (WindowControls). Left out in full screen, and when the system draws its own. */
  controls?: ReactNode;
  /**
   * The system draws the window's controls over the bar's right end (Linux, Windows: useWindowControlsOverlay). The
   * bar then shows none of its own, needs no inset for them, and leaves the overlay's corner free.
   */
  systemControls?: boolean;
  /** More in the lead band, after the controls: the sidebar button. */
  lead?: ReactNode;
  leadWidth?: WindowBarLead;
  /**
   * Fold the band when leadWidth changes (the sidebar opening or closing). Off
   * when the change comes with another page (the shell to onboarding).
   */
  foldAnimation?: boolean;
  /** Full screen: no controls, no inset, no dragging (DESIGN.md, "Window"). */
  fullScreen?: boolean;
  /** The page's title and actions are portalled into these (the app shell's Toolbar slots). */
  titleSlot?: Ref<HTMLDivElement>;
  actionsSlot?: Ref<HTMLDivElement>;
  /** The Avartan mark before the title. Off where the page shows the full logo (onboarding). */
  mark?: boolean;
  /** What stays at the start of the page side: Back and Forward. The mark goes with the title, not with these. */
  nav?: ReactNode;
  /** Or passed directly (previews, tests). */
  title?: ReactNode;
  actions?: ReactNode;
  /** The bar's own, after the page's actions at its right end: the models' download. Not the page's. */
  end?: ReactNode;
  /**
   * The bar follows the page grid (page-grid.css): while a page claims it, the title sits on the page's column and
   * the page's actions end on it. The app's bar only; a preview of the bar inside a page keeps its own layout.
   */
  grid?: boolean;
  /**
   * A double-click on an empty part of the bar that reached the page (the
   * system acts on real ones itself in a drag region; see DESIGN.md).
   */
  onDoubleClick?: () => void;
  /** The page's banner landmark (default). Previews of the bar inside a page pass false: a page has one banner. */
  banner?: boolean;
  className?: string;
}

export interface WindowTitleProps {
  /** The page's name, translated. */
  title: string;
  /** What is open in it: a chat's or a project's name, shown as written (wrap it in UserContent). */
  detail?: ReactNode;
  /** h1 on pages whose name is their heading; a plain line where the page has its own (onboarding). */
  as?: 'h1' | 'p';
}

/**
 * The page's name in the bar: 17 px bold (DESIGN.md type, toolbar titles),
 * then what is open in it, after a quiet chevron. Ink-3 when the window is
 * not the active one.
 */
export function WindowTitle({ title, detail, as: Tag = 'h1' }: WindowTitleProps) {
  return (
    <Tag
      data-slot="window-title"
      className="m-0 flex min-w-0 items-center gap-1 type-page-title text-ink window-inactive:text-ink-3"
    >
      {detail ? (
        <>
          <span className="shrink-0 font-medium text-ink-2 window-inactive:text-ink-3">{title}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 truncate">{detail}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{title}</span>
      )}
    </Tag>
  );
}

/** The overlay's width: the window's less the title bar area the system leaves the page (0 without an overlay). */
const SYSTEM_CONTROLS_WIDTH = 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))';

/** What in the bar takes its own clicks: a double-click on one of these is not a double-click on the bar. */
const CLICKABLE = 'button, a, input, select, textarea, [role=button], [data-slot=window-controls]';

/** True when the event started on the bar itself, not on a control, link or field in it. */
function onEmptyBar(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as Element | null;
  return !target?.closest(CLICKABLE);
}

/**
 * The room the bar's own end takes, as wide as what it holds (the analysis count and the download, LIB1-PROG), so
 * the page's actions end 8 px before it: its width plus its 12 px inset and that gap. page-grid.css's 3rem stands
 * until it is measured; nothing in it, the bar's 12 px.
 */
function useEndRoom() {
  const main = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = main.current;
    const own = end.current;
    if (!bar || !own || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const width = own.getBoundingClientRect().width;
      if (width <= 0) return void bar.style.removeProperty('--bar-end');
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not words
      bar.style.setProperty('--bar-end', `calc(${width}px + 1.25rem)`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(own);
    return () => {
      observer.disconnect();
      bar.style.removeProperty('--bar-end');
    };
  }, []);
  return { main, end };
}

/**
 * The app's own window bar: a 52 px unified toolbar that is also the title
 * bar. Left, the traffic controls in the sidebar's top band; then Back and
 * Forward, and the Avartan mark and the page's title on the page's column;
 * the page's actions on the column's right edge, and the bar's own end. The
 * bar is a drag region; everything clickable in it is not. Painted by the
 * page in both themes. Its band folds with the sidebar; nothing else moves.
 */
export function WindowBar({
  controls,
  systemControls = false,
  lead,
  leadWidth = 'inset',
  foldAnimation = true,
  fullScreen = false,
  titleSlot,
  actionsSlot,
  title,
  actions,
  end,
  mark = true,
  nav,
  grid = false,
  onDoubleClick,
  banner = true,
  className,
}: WindowBarProps) {
  const Root = banner ? 'header' : 'div';
  const sidebar = leadWidth === 'sidebar';
  const ownControls = !fullScreen && !systemControls;
  const showLead = sidebar || ownControls || Boolean(lead);
  const parts = useBandFold(sidebar, foldAnimation);
  const room = useEndRoom();
  const at = sidebar ? 0 : 1;
  return (
    // The banner landmark: the title, the page's actions and the window controls are all inside one (WCAG 1.3.1).
    <Root
      data-slot="window-bar"
      data-full-screen={fullScreen || undefined}
      data-grid={grid || undefined}
      // On Linux and Windows the system's controls take the bar's right end: the page's actions end before them.
      style={
        systemControls && !fullScreen
          ? ({ '--bar-overlay': SYSTEM_CONTROLS_WIDTH } as CSSProperties)
          : undefined
      }
      className={cn(
        'relative z-30 flex h-toolbar shrink-0 items-stretch bg-canvas text-ink',
        fullScreen ? 'select-none' : 'app-drag',
        className,
      )}
      onDoubleClick={(event) => {
        if (onDoubleClick && !fullScreen && onEmptyBar(event)) onDoubleClick();
      }}
    >
      {showLead ? (
        <div
          data-slot="window-bar-lead"
          data-lead={leadWidth}
          className={cn(
            'relative flex shrink-0 items-center gap-1 pl-3',
            sidebar ? 'w-60 pr-2' : ownControls ? 'min-w-window-inset pr-2' : 'pr-1',
          )}
        >
          {/* The sidebar's top: its colour and right hairline narrow to the rail and fade as it folds. */}
          <span
            ref={parts.band}
            aria-hidden
            data-slot="window-bar-band"
            className="pointer-events-none absolute inset-y-0 left-0 w-60 origin-left bg-sidebar"
            style={bandAt(at)}
          />
          <span
            ref={parts.edge}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-px bg-sidebar-border"
            style={edgeAt(at)}
          />
          {/* Alone, the band carries on the bar's hairline. */}
          <span
            ref={parts.floor}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-rule-subtle"
            style={floorAt(at)}
          />
          {ownControls ? <div className="relative flex items-center">{controls}</div> : null}
          {lead ? (
            <FoldFlip
              collapsed={!sidebar}
              enabled={foldAnimation}
              className="app-no-drag relative ml-auto flex items-center"
            >
              {lead}
            </FoldFlip>
          ) : null}
        </div>
      ) : null}
      <div
        ref={room.main}
        data-slot="window-bar-main"
        className={cn(
          'relative flex min-w-0 flex-1 items-center gap-3 border-b border-rule-subtle',
          showLead ? 'pl-4' : 'pl-5',
        )}
      >
        {/* Back and Forward stay at the bar's start; the mark and the title move out to the page's column
            together (page-grid.css pads the heading row). Each slides with the fold on its own, as each moves its
            own distance. */}
        {nav ? (
          <FoldFlip collapsed={!sidebar} enabled={foldAnimation} className="flex shrink-0 items-center gap-3">
            {nav}
          </FoldFlip>
        ) : null}
        {/* The slide sits inside the heading's padding, so it measures where the mark and title end up, padding and
            all: the padding changes with the fold too, and outside the slide it would jump the title back. */}
        <div data-slot="window-bar-heading" className="flex min-w-0 flex-1 items-center">
          <FoldFlip
            collapsed={!sidebar}
            enabled={foldAnimation}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            {mark ? <AvartanMark /> : null}
            <div ref={titleSlot} data-slot="window-bar-title" className="flex min-w-0 flex-1 items-center">
              {title}
            </div>
          </FoldFlip>
        </div>
        <div
          data-slot="window-bar-actions"
          className="app-no-drag flex shrink-0 items-center gap-2 empty:hidden"
        >
          {actionsSlot ? <div ref={actionsSlot} className="flex items-center gap-2 empty:hidden" /> : null}
          {actions}
        </div>
        <div
          ref={room.end}
          data-slot="window-bar-end"
          className="app-no-drag absolute inset-y-0 right-3 flex items-center gap-2 empty:hidden"
        >
          {end}
        </div>
      </div>
      {/*
        The system's controls: as wide as the window less the title bar area the system leaves the page, so nothing
        of the bar's sits under them. 0 without an overlay. The hairline runs on under them.
      */}
      {systemControls && !fullScreen ? (
        <span
          aria-hidden
          data-slot="window-bar-system-controls"
          className="shrink-0 border-b border-rule-subtle"
          style={{ width: SYSTEM_CONTROLS_WIDTH }}
        />
      ) : null}
    </Root>
  );
}
