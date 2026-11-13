// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: first run's frame (UX3, UX4 widths) · genre: atmospheric studio app (brand moment, quiet) · system:
 *   DESIGN.md v0.6 + _orch/ux4/specs/design-onb.md
 * layout: an app shell under the window bar. The steps' sidebar (the logo, the rail of beats, Getting ready)
 *   stands still on the left behind a hairline; the step's own content scrolls in the column beside it; its actions
 *   stand still at the column's foot on a hairline, lined up with the content above them. The welcome has no
 *   sidebar: its words and figure scroll, its actions stand still. Only the content scrolls (UX3: the PO saw the
 *   rail and the actions scroll away on a short window). Widths are the page grid's (UX4): a step is a reading
 *   column, the welcome a standard one, each with the page gutter either side.
 * states: n/a (layout); the sidebar scrolls on its own only when the window is shorter than it
 */
import { cn, ScrollArea } from '@taalcut/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** How wide the content and its actions run (the page grid's measures, plus the gutter): a step, or the welcome. */
const WIDTHS = {
  step: 'max-w-[calc(var(--container-page-reading)+var(--spacing-page-gutter)*2)]',
  welcome: 'max-w-[calc(var(--container-page-standard)+var(--spacing-page-gutter)*2)]',
} as const;

/**
 * Whether the content runs past its column, so it can scroll. Then the column takes keyboard focus (a step whose
 * content has nothing to tab to, such as This Mac with everything downloaded, still scrolls with the arrows).
 */
function useOverflows() {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return undefined;
    const check = () => setOverflows(scroller.scrollHeight > scroller.clientHeight + 1);
    check();
    const sizes = new ResizeObserver(check);
    sizes.observe(scroller);
    for (const child of scroller.children) sizes.observe(child);
    return () => sizes.disconnect();
  }, []);
  return { ref, overflows };
}

export interface OnboardingFrameProps {
  /** The screen's name (its heading): the scrolling content's name when it takes focus. */
  label: string;
  /** The steps' sidebar; the welcome has none. */
  sidebar?: ReactNode;
  /** The actions, standing still under the content. */
  footer: ReactNode;
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  /** The welcome sits in the middle of its column when there is room; the steps start at the top, as a form does. */
  centred?: boolean;
}

export function OnboardingFrame({
  label,
  sidebar,
  footer,
  children,
  width = 'step',
  centred = false,
}: OnboardingFrameProps) {
  const column = cn('mx-auto w-full px-page-gutter', WIDTHS[width]);
  const content = useOverflows();
  return (
    <div data-slot="onboarding-frame" className="flex h-full min-h-0 w-full">
      {sidebar ? (
        <div
          data-slot="onboarding-sidebar"
          className="flex w-60 shrink-0 flex-col gap-8 overflow-y-auto overscroll-contain border-e border-rule-subtle px-6 pt-6 pb-6 scrollbar-thin"
        >
          {sidebar}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The scroll area keeps its own data-slot (scroll-area): tests and the bones find scrollers by it. */}
        <ScrollArea
          ref={content.ref}
          data-onboarding="content"
          {...(content.overflows ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}
          className="flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <div className={cn(column, 'flex min-h-full flex-col pt-10 pb-12', centred && 'justify-center')}>
            {children}
          </div>
        </ScrollArea>
        <div data-slot="onboarding-footer" className="shrink-0 border-t border-rule-subtle bg-canvas">
          <div className={cn(column, 'pt-4 pb-5')}>{footer}</div>
        </div>
      </div>
    </div>
  );
}
