// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the map's controls · mode: Persuade · system: WEB2 Remix Vernacular
 * states: profile segment waiting (violet-soft with its name in violet-strong, as a template's slot waits) · hover (a
 *   step deeper: the hover face over it) · focus (the base ring) · active (2 % give) · chosen (violet with violet ink,
 *   as a filled slot; the fill glides between segments by shared layout) · Local only off (sunken track, knob home) ·
 *   on (a teal track fades in, the knob slides over and shows the shield: yours) · focus (base ring) · reduced motion
 *   (the fill and knob jump; the track's fade is 150 ms) · without JavaScript (Everyday chosen, Local only off).
 * The app's two settings that decide what leaves your computer, each with where it lives: the profile picker
 * (Settings › Models) as the world's segment bar, four segments with the app's names (the chosen one's line shows on
 * the map, with the model it picks); and the Local only switch (Settings › Privacy) with its line. A radio group (one
 * tab stop, arrow keys, Home and End) and a real switch. */

import { ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { type KeyboardEvent, useId, useRef } from 'react';
import { LOCAL_ONLY, PROFILES, PROFILES_DEMO } from '#content/providers';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { type ProfileName, profileLine, stepProfile } from './model';

function Where({ children }: { readonly children: string }) {
  return <span className="type-meta whitespace-nowrap text-ink-3">{children}</span>;
}

export function ProfilePicker({ value, onChange, reduce }: { readonly value: ProfileName; readonly onChange: (p: ProfileName) => void; readonly reduce: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const lineId = useId();
  const index = PROFILES.findIndex(([name]) => name === value);
  const onKey = (e: KeyboardEvent) => {
    // From the focused segment (the chosen one, since only it is in the tab order), then wrap.
    const focused = refs.current.findIndex((el) => el === document.activeElement);
    const next = stepProfile(focused >= 0 ? focused : index, e.key);
    if (next === null) return;
    e.preventDefault();
    onChange(PROFILES[next]![0]);
    refs.current[next]?.focus();
  };
  return (
    <div data-slot="map-profiles" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span id={labelId} className="type-label font-semibold text-ink">
          {PROFILES_DEMO.profileLabel}
        </span>
        <Where>{PROFILES_DEMO.modelsWhere}</Where>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={lineId} onKeyDown={onKey} className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {PROFILES.map(([name], i) => {
          const chosen = name === value;
          return (
            <button
              key={name}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              data-profile={name}
              onClick={() => onChange(name)}
              className={cn(
                'relative isolate inline-flex h-11 min-w-0 items-center justify-center rounded-md px-3 type-label font-semibold whitespace-nowrap select-none',
                'transition-[color,transform] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
                chosen ? 'text-violet-ink' : 'bg-violet-soft text-violet-strong hover:bg-hover hover:text-ink',
              )}
            >
              {chosen ? (
                <motion.span
                  layoutId="map-profile-fill"
                  aria-hidden
                  className="absolute inset-0 -z-10 rounded-md bg-violet shadow-sm"
                  transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
                />
              ) : null}
              {name}
            </button>
          );
        })}
      </div>
      {/* The chosen profile's line shows on the map, with the model it picks; here it describes the group and is
          announced on a change. */}
      <p id={lineId} aria-live="polite" className="sr-only">
        {profileLine(value)}
      </p>
    </div>
  );
}

export function LocalOnlySwitch({ on, onChange, reduce }: { readonly on: boolean; readonly onChange: (on: boolean) => void; readonly reduce: boolean }) {
  const id = useId();
  return (
    <div data-slot="map-local-only" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span id={`${id}-label`} className="type-label font-semibold text-ink">
          {LOCAL_ONLY.switchLabel}
        </span>
        <Where>{PROFILES_DEMO.privacyWhere}</Where>
      </div>
      {/* The whole row is the switch, so its target is large on a phone. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-line`}
        onClick={() => onChange(!on)}
        className={cn(
          'flex min-h-11 w-full items-center gap-3 rounded-md text-left select-none',
          'transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-[0.99] motion-reduce:active:scale-100',
        )}
      >
        <span aria-hidden className="relative isolate inline-flex h-8 w-14 shrink-0 items-center rounded-pill border border-rule-strong bg-sunken p-1">
          {on ? (
            <motion.span
              className="absolute -inset-px -z-10 rounded-pill border border-teal-strong bg-teal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
            />
          ) : null}
          <span
            className={cn(
              'inline-grid size-6 place-items-center rounded-pill shadow-sm transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
              on ? 'translate-x-6 bg-canvas text-teal-strong' : 'translate-x-0 bg-thumb text-on-thumb',
            )}
          >
            {on ? <ShieldCheck strokeWidth={ICON_STROKE} className="size-3.5" /> : null}
          </span>
        </span>
        <span id={`${id}-line`} className="type-label font-normal text-ink-2">
          {LOCAL_ONLY.switchLine}
        </span>
      </button>
    </div>
  );
}
