// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: theme toggle (the sidebar's one theme control, open and on the rail) · genre: atmospheric
 *   studio app · system: DESIGN.md v0.3
 * one click always flips what you see: light → dark, dark → light, leaving "Match the Mac" if it was on (that
 *   choice lives in Settings › About › Appearance and ⌘K). Its icon is the theme you are in (the sun by day, the
 *   moon by night), so it tells the same story as the scene that plays across the window: the sun in the button
 *   sets as the big one does. Its name says what a click does: "Switch to dark" / "Switch to light".
 * motion: sun ↔ moon morph (ThemeIcon), as the scene's horizon reaches the button (theme-scene.ts plays the
 *   scene across the window).
 * states: default · hover (hover surface, ink) · focus (base ring, instant) · active (pressed surface) ·
 *   disabled (ink-disabled, no surface) · loading/error/success: n/a (the switch is instant and local); while
 *   its scene plays it keeps its hover surface (the scene takes the pointer)
 */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import { useTheme } from './react';
import { ThemeIcon } from './theme-icon';
import { horizonReaches, preloadScene } from './theme-scene';
import { originOf, scenePlays, THEME_TRANSITION_MS } from './theme-transition';

/** What the toggle does now, for its name and tooltip: "Switch to dark" or "Switch to light". */
export function useThemeToggleLabel(): string {
  const { t } = useLingui();
  const { resolved } = useTheme();
  return resolved === 'dark' ? t`Switch to light` : t`Switch to dark`;
}

/**
 * Whether the open toggle's mode ("Light") gives its label the room: only when the label wouldn't fit beside it, as
 * in a longer language or a font wider than the Mac's (Linux's). The mode stays for screen readers, and the icon
 * still shows it. Measured with the mode shown, again when the words, the button's width or the fonts change.
 */
function useModeGivesWay(button: RefObject<HTMLButtonElement | null>, on: boolean, words: string): boolean {
  const [givesWay, setGivesWay] = useState(false);
  useLayoutEffect(() => {
    const el = button.current;
    if (!on || !el) return undefined;
    const measure = () => {
      const label = el.querySelector<HTMLElement>('[data-slot=fold-label]');
      if (!label) return;
      const was = el.getAttribute('data-mode-gives-way');
      el.removeAttribute('data-mode-gives-way');
      const over = label.scrollWidth - label.clientWidth > 1;
      if (was !== null) el.setAttribute('data-mode-gives-way', was);
      setGivesWay(over);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    let live = true;
    if ('fonts' in document) void document.fonts.ready.then(() => live && measure());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [button, on, words]);
  return on && givesWay;
}

export interface ThemeToggleProps extends ComponentProps<'button'> {
  /** Renders a full-width studio theme switcher CTA with label and Light/Dark status pill. */
  showLabel?: boolean;
}

/** Flips light and dark in one click. */
export function ThemeToggle({
  showLabel = false,
  className,
  onClick,
  onPointerEnter,
  onFocus,
  ref,
  ...props
}: ThemeToggleProps) {
  const { t } = useLingui();
  const { resolved, toggle } = useTheme();
  const label = useThemeToggleLabel();
  const modeLabel = resolved === 'dark' ? t`Dark` : t`Light`;
  // The scene takes the pointer while it plays, so the button would lose its hover surface and get it back.
  const [held, setHeld] = useState(false);
  // The icon turns as the scene's horizon passes the button, not before (it is under the old picture till then).
  const [morphDelay, setMorphDelay] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const self = useRef<HTMLButtonElement | null>(null);
  const modeGivesWay = useModeGivesWay(self, showLabel, `${label} ${modeLabel}`);
  // The scene's art, fetched and decoded while nothing else is going on, so the first flip has it.
  useEffect(() => {
    const id = setTimeout(preloadScene, 2000);
    return () => clearTimeout(id);
  }, []);
  return (
    <button
      ref={(node) => {
        self.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="button"
      data-slot="theme-toggle"
      data-theme-now={resolved}
      data-held={held || undefined}
      data-mode-gives-way={modeGivesWay || undefined}
      // With its words shown the button is named by them, the mode included: the name holds what it shows (2.5.3).
      aria-label={showLabel ? undefined : label}
      onPointerEnter={(event) => {
        preloadScene();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        preloadScene();
        onFocus?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const box = event.currentTarget.getBoundingClientRect();
        const kind = resolved === 'dark' ? 'daybreak' : 'nightfall';
        const reaches = horizonReaches(kind, box.top + box.height / 2);
        setMorphDelay(scenePlays() ? Math.max(0, reaches - (DUR.short * 1000) / 2) : 0);
        if (event.detail > 0) setHeld(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setHeld(false);
          setMorphDelay(0);
        }, THEME_TRANSITION_MS + 50);
        void toggle({ from: originOf(event) });
      }}
      className={cn(
        'group/theme cursor-pointer transition-colors duration-(--dur-micro) ease-(--ease-out)',
        showLabel
          ? 'flex h-[2.125rem] w-full min-w-0 items-center gap-2.5 rounded-md px-3 type-label text-ink-2 hover:bg-sidebar-hover hover:text-ink data-held:bg-sidebar-hover data-held:text-ink active:bg-sidebar-pressed'
          : 'grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-sidebar-hover hover:text-ink data-held:bg-sidebar-hover data-held:text-ink active:bg-sidebar-pressed',
        // It lives in the sidebar: the sidebar's own hover and pressed tones (UX4), as its rows have.
        // The UI kit's forced states (theme-scene.preview.tsx).
        'in-[.is-hover]:bg-sidebar-hover in-[.is-hover]:text-ink in-[.is-active]:bg-sidebar-pressed',
        'in-[.is-focus]:outline-(length:--rule-fine) in-[.is-focus]:outline-offset-2 in-[.is-focus]:outline-focus in-[.is-focus]:outline-solid',
        'disabled:pointer-events-none disabled:opacity-55 disabled:text-ink-disabled',
        className,
      )}
      {...props}
    >
      {showLabel ? (
        <>
          <span className="inline-grid shrink-0 place-items-center text-ink-3 transition-colors duration-(--dur-micro) group-hover/theme:text-ink-2 window-inactive:text-ink-3">
            <ThemeIcon theme={resolved} delay={morphDelay} />
          </span>
          <span data-slot="fold-label" className="min-w-0 flex-1 truncate text-left">
            {label}
          </span>{' '}
          <span
            data-slot="fold-fade"
            className="shrink-0 text-xs font-normal text-ink-3 group-data-mode-gives-way/theme:sr-only"
          >
            {modeLabel}
          </span>
        </>
      ) : (
        <ThemeIcon theme={resolved} delay={morphDelay} />
      )}
    </button>
  );
}
