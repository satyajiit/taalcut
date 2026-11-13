// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the starters, a shelf of 9:16 templates · mode: Operate · system: WEB2 Remix Vernacular (violet is the
 *   AI's slots, as in the template beside it; the format is a word and its glyph in ink, no hue of its own)
 * the templates Taalcut ships for a day with no reel to copy, as the language you use sees them: each a 9:16 card
 *   like the template above, its own slots stacked as tall as their time (its rhythm at a glance: the quick run of a
 *   highlight reel, the long takes of a talking head), its format, its name, its length and its slot count; a starter
 *   offered in one language says which. A segmented choice switches the language; the shelf scrolls sideways on a
 *   narrow screen
 * states: the language choice (segmented.tsx's states) · a card: default · hover (it lifts 2 px on a fine pointer) ·
 *   not a control (the app opens a starter; the site shows them) · reduced motion: no lift
 * motion: the two cards a language brings fade in (opacity, --dur-short); the server HTML and the first render rest
 *   shown */

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { FORMAT_ICONS } from '../icons';
import { Segmented } from '../segmented';
import { formatOf, LANGUAGES, type Starter, type StarterLanguage, startersIn } from './starters';

/** Its slots stacked as tall as their time, every other one in the strong violet, so each reads as its own. */
function Rhythm({ slots }: { readonly slots: readonly number[] }) {
  return (
    <span aria-hidden className="flex min-h-0 flex-1 flex-col gap-[2px]">
      {slots.map((s, i) => (
        <span
          key={i}
          className={cn('block min-h-[2px] rounded-[3px]', i % 2 === 0 ? 'bg-violet' : 'bg-violet-soft')}
          style={{ flexGrow: s, flexBasis: 0 }}
        />
      ))}
    </span>
  );
}

function StarterCard({ starter }: { readonly starter: Starter }) {
  const format = formatOf(starter.format);
  const Icon = FORMAT_ICONS[starter.format];
  return (
    <motion.li
      data-starter={starter.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.short, ease: EASE_OUT }}
      className="flex aspect-[9/16] w-34 shrink-0 snap-start flex-col gap-2 rounded-2xl border border-rule-subtle bg-raised p-2.5 shadow-sticker transition-transform duration-(--dur-short) ease-(--ease-out) hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 @min-[58rem]:w-auto"
    >
      <span className="flex items-center gap-1 type-caption font-semibold text-ink-2">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {format.name}
      </span>
      <Rhythm slots={starter.slots} />
      <span className="flex flex-col gap-0.5">
        <span className="min-h-[2lh] type-label-sm leading-tight font-semibold text-pretty text-ink">
          {starter.name}
        </span>
        <span className="type-caption text-ink-2 tabular-nums">
          {starter.seconds} s, {starter.slots.length} slots
        </span>
        {starter.language ? (
          <span className="type-caption text-ink-2">Only in {starter.language}</span>
        ) : null}
      </span>
    </motion.li>
  );
}

export function StarterShelf() {
  const [language, setLanguage] = useState<StarterLanguage>('English');
  const starters = startersIn(language);
  return (
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex max-w-[34rem] flex-col gap-1">
          <h3 className="m-0 type-site-subhead text-ink">No reel to copy? Start from a starter</h3>
          <p className="m-0 type-site-body text-ink-2">
            Each is a template like the one above, its slots on the music beats, ready for your clips.
          </p>
        </div>
        <Segmented
          label="Starters in"
          options={LANGUAGES.map((l) => ({ value: l, label: l }))}
          value={language}
          onChange={setLanguage}
        />
      </div>
      <ul
        aria-label={`Starters in ${language}`}
        className="m-0 -mx-1 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain p-1 pb-3 @min-[58rem]:grid @min-[58rem]:grid-cols-8 @min-[58rem]:overflow-visible @min-[58rem]:pb-1"
      >
        <AnimatePresence initial={false}>
          {starters.map((s) => (
            <StarterCard key={s.id} starter={s} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
