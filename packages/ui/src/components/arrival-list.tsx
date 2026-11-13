// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: arrival list (UX4, extends the chat's Arrival) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: the UX4 motion grammar
 * a list whose items arrive as a list: each rises 8 px and fades in (--dur-short, --ease-out), 40 ms after the one
 *   before, and the whole cascade is capped at 240 ms, so the 40th row waits no longer than the 7th. An item that
 *   joins the list later (a new export, a clip landing) arrives on its own, at once. Off (`animate={false}`) for
 *   what was already there when the page opened: a page never animates in what it already had.
 * states: n/a (a container)
 * reduced motion: the items fade in together over 150 ms, nothing rises */
import { motion, useReducedMotion } from 'motion/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { DUR, EASE_OUT, REDUCED_FADE, RISE, staggerDelay } from '#lib/motion';

/** An item mounting this long after its list did joined it later: it arrives at once. */
const LATE_MS = 80;

interface ArrivalContext {
  readonly animate: boolean;
  readonly since: number;
}
const Arriving = createContext<ArrivalContext>({ animate: false, since: 0 });

export interface ArrivalListProps {
  /** Play the cascade: on for a list that just loaded or changed, off for one that was there. */
  animate?: boolean;
  /** `ul` (the default), `ol` or a plain `div` (a grid of tiles). */
  as?: 'ul' | 'ol' | 'div';
  className?: string;
  children: ReactNode;
}

/** The list: its ArrivalItems cascade in once, capped. */
export function ArrivalList({ animate = true, as: Root = 'ul', className, children }: ArrivalListProps) {
  const [since] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));
  return (
    <Arriving.Provider value={{ animate, since }}>
      <Root data-slot="arrival-list" className={className}>
        {children}
      </Root>
    </Arriving.Provider>
  );
}

export interface ArrivalItemProps {
  /** Its place in the list, for the stagger (0 first). */
  index: number;
  /** `li` (the default) or a `div` in a grid. */
  as?: 'li' | 'div';
  className?: string;
  children: ReactNode;
}

/** One item of an ArrivalList. */
export function ArrivalItem({ index, as = 'li', className, children }: ArrivalItemProps) {
  const { animate, since } = useContext(Arriving);
  const reduce = useReducedMotion() ?? false;
  const [late] = useState(() => typeof performance !== 'undefined' && performance.now() - since > LATE_MS);
  const Item = as === 'li' ? motion.li : motion.div;
  if (!animate) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  return (
    <Item
      data-slot="arrival-item"
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: RISE }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={
        reduce
          ? { duration: REDUCED_FADE, ease: 'linear' }
          : { duration: DUR.short, ease: EASE_OUT, delay: late ? 0 : staggerDelay(index) }
      }
    >
      {children}
    </Item>
  );
}
