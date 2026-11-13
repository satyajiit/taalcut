// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: analytics switch · mode: Persuade (site chrome) · system: WEB2 Remix Vernacular
 * The footer's base line carries one quiet button beside the company's credit, with the credit's own type and states.
 * It says what a click does: "Turn off analytics" or "Turn on analytics". The choice is remembered
 * (lib/analytics/choice.ts), and a polite status line tells a screen reader what changed.
 * states: default (ink-2, its icon ink-3) · hover (ink, underline) · focus (base ring) · active (pressed surface) ·
 *   disabled/loading/error/success: n/a (the switch is instant and local)
 * Server HTML has no switch: the choice lives in the browser, and analytics needs JavaScript anyway. It appears
 * after hydration, in the footer, below the fold, so nothing above it moves. */

import { ChartColumn } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconText } from '#components/ui/icon-text';
import { ANALYTICS_SWITCH } from '#content/site';
import { currentChoice, subscribeChoice, writeChoice, type AnalyticsChoice } from '#lib/analytics/choice';
import { ANALYTICS_ON, countPageView, settledTitle, startAnalytics, stopAnalytics } from '#lib/analytics/load';

const onServer = (): AnalyticsChoice | null => null;

/** The visitor's choice, or null on the server and in a build that doesn't count visits. */
function useChoice(): AnalyticsChoice | null {
  const choice = useSyncExternalStore(subscribeChoice, currentChoice, onServer);
  return ANALYTICS_ON ? choice : null;
}

/**
 * Starts counting once the page has loaded and gone idle, follows the switch after that, and counts each page the
 * visitor moves to (after the commit, so the new page's title is in place). Renders nothing.
 */
export function AnalyticsBoot() {
  const choice = useChoice();
  const booted = useRef(false);
  const pathname = usePathname();
  const last = useRef<{ path: string; title: string } | null>(null);
  useEffect(() => {
    if (!ANALYTICS_ON) return;
    const previous = last.current;
    if (previous === null) {
      last.current = { path: pathname, title: document.title };
      return;
    }
    if (previous.path === pathname) return;
    last.current = { path: pathname, title: previous.title };
    void settledTitle(previous.title).then((title) => {
      // A visitor who moved on again meanwhile is counted on the page they reached.
      if (last.current?.path !== pathname) return;
      last.current = { path: pathname, title };
      countPageView(previous.path, title);
    });
  }, [pathname]);
  useEffect(() => {
    if (choice === null) return;
    if (choice === 'off') {
      stopAnalytics();
      return;
    }
    if (booted.current) {
      startAnalytics();
      return;
    }
    // The first start waits for the page: after `load`, then an idle moment, so the tag never delays a paint.
    let cancelled = false;
    let idle = 0;
    const begin = () => {
      const ric = window.requestIdleCallback;
      const go = () => {
        if (cancelled) return;
        booted.current = true;
        startAnalytics();
      };
      if (ric) idle = ric(go, { timeout: 4000 });
      else idle = window.setTimeout(go, 1500);
    };
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', begin);
      window.cancelIdleCallback?.(idle);
      window.clearTimeout(idle);
    };
  }, [choice]);
  return null;
}

/** The footer's "Turn off analytics" / "Turn on analytics". */
export function AnalyticsSwitch({ className }: { readonly className?: string }) {
  const choice = useChoice();
  const [said, setSaid] = useState('');
  if (choice === null) return null;
  const on = choice === 'on';
  return (
    <>
      <button
        type="button"
        data-slot="analytics-switch"
        data-choice={choice}
        className={className}
        onClick={() => {
          const next: AnalyticsChoice = on ? 'off' : 'on';
          writeChoice(next);
          setSaid(next === 'off' ? ANALYTICS_SWITCH.saidOff : ANALYTICS_SWITCH.saidOn);
        }}
      >
        <IconText icon={ChartColumn} tone="muted">
          {on ? ANALYTICS_SWITCH.turnOff : ANALYTICS_SWITCH.turnOn}
        </IconText>
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-slot="analytics-said">
        {said}
      </span>
    </>
  );
}
