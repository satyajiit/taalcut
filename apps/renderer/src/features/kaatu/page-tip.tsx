// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { KaatuMoment } from '@taalcut/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { focusMain, nothingFocused } from '../../shell/nav/lost-focus';
import { useFirstVisitTip } from './tips';

export interface PageTipProps {
  /** The page's own id for its tip ("chat-start"): dismissed once, gone for good. */
  id: string;
  /** The tip: one line. */
  children: ReactNode;
  /**
   * Kaatu beside it. Off where the page already shows Kaatu (a hero, an empty state): the tip then speaks through
   * that one, so a screen never has more than one moment and the companion.
   */
  kaatu?: boolean;
  className?: string;
}

/**
 * A page's first-visit tip (UX4): Kaatu and one line, with a dismiss that is remembered (tips.ts). For the page
 * lanes: one per page, about what the page doesn't say itself; never on a page that is empty (its empty state
 * teaches), over footage, in a decision card or in the composer.
 */
export function PageTip({ id, children, kaatu = true, className }: PageTipProps) {
  const tip = useFirstVisitTip(id);
  // The dismiss button goes with the tip and would take focus with it: the page's main area takes it, as after a
  // navigation (lost-focus.ts), so the next Tab carries on in the page.
  const dismissed = useRef(false);
  useEffect(() => {
    if (tip.shown || !dismissed.current) return;
    dismissed.current = false;
    if (nothingFocused()) focusMain();
  }, [tip.shown]);
  if (!tip.shown) return null;
  const dismiss = () => {
    dismissed.current = true;
    tip.dismiss();
  };
  return (
    <KaatuMoment tone="tip" kaatu={kaatu} onDismiss={dismiss} {...(className ? { className } : {})}>
      {children}
    </KaatuMoment>
  );
}
