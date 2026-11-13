// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Taalcut theme engine (React binding).
//
//   const engine = createThemeEngine({ store: defaultThemeStore() });
//   await engine.init();
//   createRoot(el).render(<ThemeProvider engine={engine}><App /></ThemeProvider>);

/* Hallmark · component: theme switcher (segmented: Match the Mac · Light · Dark, in Settings) · genre: atmospheric
 *   studio app · system: DESIGN.md v0.3
 * motion: the raised thumb glides to the choice (shared layout, --dur-short, --ease-out, no overshoot); the
 *   switch itself is the window's view transition (theme-transition.ts): the day/night scene from the segment
 *   clicked when light and dark flip, a crossfade to Match the Mac.
 * states: default · hover (ink) · focus (base ring, instant) · active (pressed: ink) · checked (thumb) ·
 *   disabled: n/a (always available) · loading/error/success: n/a (the switch is instant and local)
 */
import { useLingui } from '@lingui/react/macro';
import type { ThemePreference, ThemeState } from '@taalcut/core';
import { Monitor, Moon, Sun } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import {
  createContext,
  useContext,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { THEME_OPTIONS } from './preferences';
import type { ThemeEngine } from './theme-engine';
import { centreOf, originOf } from './theme-transition';

const ThemeContext = createContext<ThemeEngine | null>(null);

export function ThemeProvider({ engine, children }: { engine: ThemeEngine; children: ReactNode }) {
  return <ThemeContext.Provider value={engine}>{children}</ThemeContext.Provider>;
}

export type UseTheme = ThemeState & Pick<ThemeEngine, 'setPreference' | 'toggle'>;

export function useTheme(): UseTheme {
  const engine = useContext(ThemeContext);
  if (!engine) throw new Error('useTheme must be used inside <ThemeProvider>');
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  return { ...state, setPreference: engine.setPreference, toggle: engine.toggle };
}

const ICONS: Record<ThemePreference, ReactNode> = {
  system: <Monitor aria-hidden />,
  light: <Sun aria-hidden />,
  dark: <Moon aria-hidden />,
};

export interface ThemeSwitcherProps {
  /** Icons only, with each name in a tooltip and as the accessible name. For narrow places like the sidebar. */
  compact?: boolean;
  className?: string;
}

/** Match the Mac · Light · Dark segmented control: a radio group where arrow keys move and select. */
export function ThemeSwitcher({ compact = false, className }: ThemeSwitcherProps) {
  const { t } = useLingui();
  const { preference, setPreference } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Each switcher's thumb glides within its own group (the sidebar and Settings › About can both show one).
  const group = useId();
  const labels: Record<ThemePreference, string> = { system: t`Match the Mac`, light: t`Light`, dark: t`Dark` };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !back) return;
    event.preventDefault();
    const count = THEME_OPTIONS.length;
    const index = (THEME_OPTIONS.indexOf(preference) + (forward ? 1 : -1) + count) % count;
    const next = THEME_OPTIONS[index];
    const target = refs.current[index];
    if (next) void setPreference(next, target ? { from: centreOf(target) } : {});
    target?.focus();
  }

  return (
    <LayoutGroup id={group}>
      <div
        role="radiogroup"
        aria-label={t`Theme`}
        onKeyDown={onKeyDown}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-xl border border-rule bg-sunken p-1 shadow-2xs',
          className,
        )}
      >
        {THEME_OPTIONS.map((option, i) => {
          const checked = option === preference;
          const button = (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={compact ? labels[option] : undefined}
              tabIndex={checked ? 0 : -1}
              onClick={(event) => void setPreference(option, { from: originOf(event) })}
              className={cn(
                'relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 text-sm font-medium whitespace-nowrap',
                'transition-colors duration-(--dur-micro) ease-(--ease-out) [&_svg]:size-3.5 [&_svg]:shrink-0',
                compact ? 'px-2.5' : 'px-3.5',
                checked ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink active:text-ink',
              )}
            >
              {checked ? (
                <motion.span
                  aria-hidden
                  layoutId="thumb"
                  data-slot="theme-thumb"
                  className="absolute inset-0 rounded-lg border border-rule-subtle bg-raised shadow-xs window-inactive:shadow-none"
                  transition={{ layout: { duration: DUR.short, ease: EASE_OUT } }}
                />
              ) : null}
              <span className="relative inline-flex items-center gap-1.5">
                <span className={cn(checked && 'text-primary-strong window-inactive:text-ink-3')}>
                  {ICONS[option]}
                </span>
                {compact ? null : labels[option]}
              </span>
            </button>
          );
          if (!compact) return button;
          return (
            <Tooltip key={option}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{labels[option]}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
