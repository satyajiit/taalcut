// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The motion grammar as Tailwind classes, so every control moves the same way (UX4,
 * `_orch/ux4/specs/design-kit.md`). Colours ease over --dur-micro; a press scales by PRESS_SCALE (lib/motion.ts) on
 * the individual `scale` property. Under reduced motion base.css lets only colours and opacity ease, and the
 * `motion-reduce:` resets keep a press from scaling at all: the pressed colour carries it.
 */

/** Hover and press colours easing in and out. Rows, menu items, links, tabs. */
export const HOVER_EASE = 'transition-colors duration-(--dur-micro) ease-(--ease-out)';

/** A control's press: colours ease and it gives by 2 %. Buttons, view links, tiles' small controls. */
export const PRESS_CONTROL =
  'transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100';

/** A row's or a tile's press: colours ease and it gives by 1 % (it is wide; 2 % would travel too far). */
export const PRESS_ROW =
  'transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.99] motion-reduce:active:scale-100';

/**
 * A menu, popover or tooltip opening from its trigger: a quick pop (scale 0.98 to 1 and a fade, --dur-short) and a
 * faster fade out. Reduced motion: the fades alone. Radix sets the transform origin to the trigger's side.
 */
export const POP_IN_OUT =
  'data-[state=open]:animate-enter data-[state=closed]:animate-exit motion-reduce:data-[state=open]:animate-fade-in motion-reduce:data-[state=closed]:animate-fade-out';
