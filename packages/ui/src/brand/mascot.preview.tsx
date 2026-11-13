// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · state preview: Kaatu. Shown on /dev/kit; not used by any page.
 * Every mood at the hero size, then every antic on demand, a moment in each tone (UX4), then every place's size,
 * idle. Poke any of them. */
import { useLingui } from '@lingui/react/macro';
import { useState, type ReactNode } from 'react';
import { Button } from '../components/button';
import { KaatuMoment } from './kaatu-moment';
import { MASCOT_SIZES, Kaatu, type KaatuAntic, type MascotMood, type MascotSpot } from './mascot';

/** A labelled sample. A fixed width, so a long (or translated) caption wraps instead of overflowing. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex w-36 flex-col items-start gap-1.5">
      {children}
      <figcaption className="w-full text-xs text-ink-3">{label}</figcaption>
    </figure>
  );
}

export function MascotPreview() {
  const { t, i18n } = useLingui();
  const [antic, setAntic] = useState<{ name: KaatuAntic; key: number } | null>(null);
  const moods: { mood: MascotMood; label: string }[] = [
    { mood: 'idle', label: t`Idle: turns to the pointer` },
    { mood: 'thinking', label: t`Thinking: a run is going` },
    { mood: 'happy', label: t`Happy: a run finished well` },
    { mood: 'oops', label: t`Oops: a run failed` },
    { mood: 'sleep', label: t`Asleep: a minute untouched` },
  ];
  const antics: { name: KaatuAntic; label: string }[] = [
    { name: 'snack', label: t`Snack` },
    { name: 'yawn', label: t`Yawn` },
    { name: 'wave', label: t`Wave` },
    { name: 'dance', label: t`Dance` },
    { name: 'wonder', label: t`Wonder` },
    { name: 'action', label: t`Action!` },
    { name: 'look', label: t`Look around` },
    { name: 'cheeky', label: t`Cheeky` },
    { name: 'wink', label: t`Wink` },
  ];
  const spots: { spot: MascotSpot; label: string }[] = [
    { spot: 'line', label: t`Working line` },
    { spot: 'rail', label: t`Onboarding rail` },
    { spot: 'empty', label: t`Empty state` },
    { spot: 'message', label: t`Message page` },
    { spot: 'hero', label: t`New chat` },
    { spot: 'about', label: t`About` },
    { spot: 'companion', label: t`Companion` },
    { spot: 'moment', label: t`Moment` },
  ];
  return (
    <div data-slot="mascot-preview" className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {moods.map(({ mood, label }) => (
          <Figure key={mood} label={label}>
            <Kaatu spot="hero" mood={mood} breathe={mood !== 'thinking'} />
          </Figure>
        ))}
      </div>
      <div data-slot="mascot-antics" className="flex flex-wrap items-center gap-6">
        <Figure label={t`Antics: one now and then while idle`}>
          <Kaatu spot="about" {...(antic ? { perform: antic.name, performKey: antic.key } : {})} />
        </Figure>
        <div className="flex max-w-md flex-wrap gap-2">
          {antics.map(({ name, label }) => (
            <Button
              key={name}
              size="sm"
              variant="ghost"
              onClick={() => setAntic((now) => ({ name, key: (now?.key ?? 0) + 1 }))}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div data-slot="mascot-moments" className="flex max-w-xl flex-col gap-4">
        <KaatuMoment tone="wait">{t`Indexing your clips. About two minutes left.`}</KaatuMoment>
        <KaatuMoment tone="success">{t`Your video is exported.`}</KaatuMoment>
        <KaatuMoment tone="failure">{t`The export stopped: the disk is full. Free some space, then try again.`}</KaatuMoment>
        <KaatuMoment tone="tip" onDismiss={() => undefined}>
          {t`A tip, once per page: dismiss it and it stays dismissed.`}
        </KaatuMoment>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        {spots.map(({ spot, label }) => {
          const px = i18n.number(MASCOT_SIZES[spot]);
          return (
            <Figure key={spot} label={t`${label}, ${px} px`}>
              <Kaatu spot={spot} breathe={spot !== 'line'} />
            </Figure>
          );
        })}
      </div>
    </div>
  );
}
