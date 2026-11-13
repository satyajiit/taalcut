// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { WindowTitleProps } from '@taalcut/ui';
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavTitle } from './nav/nav-title';

/** Where the window bar takes the page's title and actions: two elements in the bar. */
export interface ToolbarSlots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
}

const Slots = createContext<ToolbarSlots>({ title: null, actions: null });

/** Set by the root, around every page, once the bar has rendered its slots. */
export const ToolbarSlotsProvider = Slots.Provider;

/**
 * A box of the page's own in one of the bar's slots, there only while the page is on screen. While the next page's
 * code loads, React keeps the leaving page mounted and hidden behind the router's pending view (a Suspense
 * fallback). Hiding a tree doesn't reach what it portals into the bar, but it does run the cleanup of its layout
 * effects, so the box leaves the bar then and comes back if the page shows again: the bar holds the title and
 * actions of what is on screen, never the leaving page's beside the bones' (UX2 round 2).
 */
function useSlotBox(slot: HTMLElement | null): HTMLElement {
  const [box] = useState(() => {
    const element = document.createElement('div');
    // No box of its own: the page's title and actions lay out in the slot as before.
    element.style.display = 'contents';
    return element;
  });
  useLayoutEffect(() => {
    if (!slot) return undefined;
    slot.append(box);
    return () => box.remove();
  }, [slot, box]);
  return box;
}

/**
 * The page's name in the window bar (DESIGN.md, "Window"): the page's h1, or
 * a plain line where the page has its own heading (onboarding, not found).
 * What is open in the page goes in `detail`, shown as written. A page under
 * another shows the way up before it, from the routes (nav/nav-title.tsx).
 */
export function ToolbarTitle(props: WindowTitleProps) {
  const { title } = useContext(Slots);
  const box = useSlotBox(title);
  return title ? createPortal(<NavTitle {...props} />, box) : null;
}

/** The page's own actions, on the right of the window bar. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(Slots);
  const box = useSlotBox(actions);
  return actions ? createPortal(children, box) : null;
}
