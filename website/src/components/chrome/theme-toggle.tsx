// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: theme toggle · mode: Persuade (site chrome) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2
 * One click flips light and dark. Its icon is the theme you are in (the sun by day, the moon by night), so it tells
 * the same story as the scene that plays across the page: nightfall washes dusk down as the sun sets out of the
 * button and the moon rises; daybreak washes light up as the sun rises (theme-scene.ts, 840 ms, View Transitions).
 * Its name says what a click does: "Switch to dark" / "Switch to light", with aria-pressed when dark.
 * states: default · hover (hover surface, ink) · focus (base ring) · active (pressed surface, 2% give) · held (keeps
 *   its hover surface while the scene plays, which takes the pointer) · disabled: n/a · loading/error/success: n/a
 *   (the switch is instant and local)
 * motion: sun ↔ moon morph as the scene's horizon reaches the button. Reduced motion: a 150 ms crossfade of the page
 *   and an instant icon. No View Transitions: an instant switch. */

import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import { ThemeIcon } from './theme-icon';
import { horizonReaches, preloadScene } from './theme-scene';
import { originOf, runThemeTransition, scenePlays, THEME_TRANSITION_MS } from './theme-transition';
import './theme-scene.css';

type Theme = 'light' | 'dark';

/** Puts the theme on <html> now (the tokens key on data-theme), so the transition's new picture has it. */
function applyNow(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export function ThemeToggle({ className }: { readonly className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const reduce = useReducedMotionPref();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  // The scene takes the pointer while it plays, so the button would lose its hover surface and get it back.
  const [held, setHeld] = useState(false);
  // The icon turns as the scene's horizon passes the button, not before (it is under the old picture till then).
  const [morphDelay, setMorphDelay] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The scene's art, fetched and decoded while nothing else is going on, so the first flip has it.
  useEffect(() => {
    const id = setTimeout(preloadScene, 2000);
    return () => clearTimeout(id);
  }, []);

  return (
    <button
      type="button"
      data-slot="theme-toggle"
      data-held={held || undefined}
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
      aria-pressed={dark}
      onPointerEnter={preloadScene}
      onFocus={preloadScene}
      onClick={(event) => {
        const next: Theme = dark ? 'light' : 'dark';
        const kind = dark ? 'daybreak' : 'nightfall';
        const box = event.currentTarget.getBoundingClientRect();
        const reaches = horizonReaches(kind, box.top + box.height / 2);
        setMorphDelay(scenePlays() ? Math.max(0, reaches - (DUR.short * 1000) / 2) : 0);
        if (event.detail > 0) setHeld(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setHeld(false);
          setMorphDelay(0);
        }, THEME_TRANSITION_MS + 50);
        void runThemeTransition(
          () => {
            applyNow(next);
            flushSync(() => setTheme(next));
          },
          kind,
          originOf(event),
        );
      }}
      className={cn(
        'inline-grid size-10 shrink-0 place-items-center rounded-pill text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'hover:bg-hover hover:text-ink data-held:bg-hover data-held:text-ink',
        'active:scale-[0.98] active:bg-pressed motion-reduce:active:scale-100',
        className,
      )}
    >
      <ThemeIcon theme={dark ? 'dark' : 'light'} delay={morphDelay} reduce={reduce} />
    </button>
  );
}
