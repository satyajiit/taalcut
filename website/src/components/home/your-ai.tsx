// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: your AI · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the stories' own (your-ai/stories: every story in one row in the server HTML; the tray and one story open,
 *   ChatGPT's, playing once on arrival) · Local only off (default: every ring lit in its way's colour) · Local only on
 *   (the cloud AIs' rings go to a dashed rule under "Off while Local only is on", Taalcut's own models' ring glows teal,
 *   and its story opens and plays) · the switch: off · on (teal track, the knob slides on a spring; at once under
 *   reduced motion) · hover (surface) · focus (base ring) · active (2 % give) · its line below says what the state
 *   means (polite live region, one line of status).
 * motion: the section's arrival, the story's run, the switch's knob; transform and opacity.
 * The compact form of /ai/'s stories: the heading, the lead and the way to /ai/, the working Local only switch as
 * Settings › Privacy has it, and the tray, led by ChatGPT, with its story open (its Continue with ChatGPT link sticker
 * up to the demo on /ai/). Every AI is named in words beside its real SVGL icon. */

import { ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Stories } from '#components/your-ai/stories/stories';
import { YOUR_AI_SECTION } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { HomeSection } from './home-section';
import { MoreLink } from './kit';

const Y = YOUR_AI_SECTION;

function LocalOnlySwitch({ on, onChange }: { readonly on: boolean; readonly onChange: (on: boolean) => void }) {
  const reduce = useReducedMotionPref();
  const lineId = useId();
  return (
    <div className={cn('flex w-full flex-col gap-2 rounded-2xl p-3.5 ring-1 transition-[background-color,box-shadow] duration-(--dur-short)', on ? 'bg-teal-soft ring-teal-strong/40' : 'bg-raised shadow-sticker ring-rule-subtle')}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={lineId}
        onClick={() => onChange(!on)}
        className="-m-2 flex min-h-11 items-center gap-3 rounded-xl p-2 text-start transition-[background-color,transform] duration-(--dur-micro) hover:bg-hover/60 active:scale-[0.98] motion-reduce:active:scale-100"
      >
        <ShieldCheck aria-hidden strokeWidth={ICON_STROKE} className={cn('size-6 shrink-0 transition-colors', on ? 'text-teal-strong' : 'text-ink-3')} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-label font-semibold text-ink">{Y.local.label}</span>
          <span className="type-meta text-ink-2">{Y.local.line}</span>
        </span>
        <span aria-hidden className={cn('flex h-7 w-12 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-(--dur-short)', on ? 'justify-end bg-teal' : 'justify-start bg-control-pressed')}>
          <motion.span layout={!reduce} transition={{ type: 'spring', stiffness: 520, damping: 32 }} className="size-6 rounded-full bg-sticker-cut shadow-sm" />
        </span>
      </button>
      <p id={lineId} aria-live="polite" className="m-0 type-label-sm text-pretty text-ink-2">
        {on ? Y.local.on : Y.local.off}
      </p>
    </div>
  );
}

export function YourAi() {
  const [local, setLocal] = useState(false);
  return (
    <HomeSection
      id="your-ai"
      heading={Y.heading}
      lead={Y.lead}
      split="5/7"
      demoClassName="max-lg:-mt-4"
      aside={
        <div className="flex flex-col items-start gap-4">
          <LocalOnlySwitch on={local} onChange={setLocal} />
          <MoreLink href="/ai/">{Y.link}</MoreLink>
        </div>
      }
    >
      <Stories variant="compact" initial="chatgpt" localOnly={local} chatgptLink="/ai/#chatgpt" />
    </HomeSection>
  );
}
