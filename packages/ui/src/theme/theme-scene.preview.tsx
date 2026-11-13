// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · state preview: the theme toggle and its day/night scene. Shown on /dev/kit; not used by any page.
 * The toggle in its states, the scene's art, and the scene itself, played across this window from the
 * button pressed (nightfall from light, daybreak from dark). */
import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import moonUrl from './art/moon.webp';
import starUrl from './art/star-1.webp';
import sunUrl from './art/sun.webp';
import { useTheme } from './react';
import { ThemeToggle } from './theme-toggle';
import { centreOf } from './theme-transition';

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex w-28 flex-col items-start gap-1.5">
      {children}
      <figcaption className="w-full text-xs text-ink-3">{label}</figcaption>
    </figure>
  );
}

function Play({ children }: { children: ReactNode }) {
  const { resolved, setPreference } = useTheme();
  return (
    <Button
      onClick={(event) =>
        void setPreference(resolved === 'dark' ? 'light' : 'dark', { from: centreOf(event.currentTarget) })
      }
    >
      {children}
    </Button>
  );
}

export function ThemeScenePreview() {
  const { t } = useLingui();
  const states: { label: string; force?: string; disabled?: boolean }[] = [
    { label: t`Default` },
    { label: t`Hover`, force: 'is-hover' },
    { label: t`Focus`, force: 'is-focus' },
    { label: t`Pressed`, force: 'is-active' },
    { label: t`Disabled`, disabled: true },
  ];
  const art = [
    { url: sunUrl, label: t`Sun, marigold` },
    { url: moonUrl, label: t`Moon, dozing` },
    { url: starUrl, label: t`Star` },
  ];
  return (
    <div data-slot="theme-scene-preview" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        {states.map(({ label, force, disabled }) => (
          <Figure key={label} label={label}>
            <span className={cn('inline-flex', force)}>
              <ThemeToggle disabled={disabled} tabIndex={force ? -1 : undefined} />
            </span>
          </Figure>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {art.map(({ url, label }) => (
          <Figure key={label} label={label}>
            <img src={url} alt="" className="size-20 rounded-lg bg-sunken object-contain p-2" />
          </Figure>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Play>{t`Play the scene`}</Play>
      </div>
    </div>
  );
}
