// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The spend chart's reading cursor (G8): which day is lifted, by the pointer or the keyboard. Focus starts on the
 * last day; arrows, Home and End move it; Escape and leaving the chart put it away. The pointer leaving doesn't
 * while the chart has focus, so a keyboard reader keeps their place.
 */
import { useState, type KeyboardEvent } from 'react';

const MOVES: Record<string, (from: number, last: number) => number> = {
  ArrowRight: (from, last) => Math.min(last, from + 1),
  ArrowLeft: (from) => Math.max(0, from - 1),
  Home: () => 0,
  End: (_, last) => last,
};

export interface DayCursor {
  readonly active: number | null;
  /** The pointer is over a day. */
  enter(index: number): void;
  /** Props for the chart's focusable group. */
  readonly group: {
    onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
    onFocus(): void;
    onBlur(): void;
    onPointerLeave(): void;
  };
}

export function useDayCursor(count: number): DayCursor {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const last = count - 1;
  return {
    active,
    enter: setActive,
    group: {
      onKeyDown(event) {
        if (event.key === 'Escape') return setActive(null);
        const move = MOVES[event.key];
        if (!move || last < 0) return;
        event.preventDefault();
        setActive((from) => move(from ?? last, last));
      },
      onFocus() {
        setFocused(true);
        setActive((from) => from ?? (count > 0 ? last : null));
      },
      onBlur() {
        setFocused(false);
        setActive(null);
      },
      onPointerLeave() {
        if (!focused) setActive(null);
      },
    },
  };
}
