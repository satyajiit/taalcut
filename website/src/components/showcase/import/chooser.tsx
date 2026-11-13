// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Library › Import, the ways in · mode: Operate · system: WEB2 Remix Vernacular (teal is yours: the way
 *   you chose)
 * rebuilt lean from the app's chooser (apps/renderer/src/features/library/imports/import-chooser.tsx): the page's
 *   title and line, then the ways in three groups (This computer, Phones, Cameras and cards), each row its glyph and
 *   its name in the app's words (the chosen way's note heads its page beside the list). On Ubuntu the ways only a Mac
 *   has leave the list, and one line under it names them with the Apple icon
 * states: a way: default · hover (the hover surface) · focus (base ring) · active (pressed) · chosen (aria-pressed:
 *   the teal field, its glyph teal, the chevron ink) · compact (the index: no title, no chevrons) ·
 *   disabled/loading/error n/a (every way listed is offered)
 * motion: rows that leave fade and the rest close up by transform (layout); reduced motion: the fade alone */

import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { groupsOn, listWords, MAC_ONLY, type Platform, WAYS, type WayId } from './ways';

const FADE = { duration: DUR.short, ease: EASE_OUT } as const;

function WayRow({
  id,
  chosen,
  compact,
  controls,
  onChoose,
}: {
  readonly id: WayId;
  readonly chosen: boolean;
  readonly compact: boolean;
  readonly controls: string;
  readonly onChoose: (id: WayId) => void;
}) {
  const way = WAYS[id];
  const Icon = way.icon;
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
      <button
        type="button"
        aria-pressed={chosen}
        aria-controls={controls}
        data-way={id}
        onClick={() => onChoose(id)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 text-start transition-colors duration-(--dur-micro) ease-(--ease-out)',
          compact ? 'min-h-10 py-1' : 'min-h-11 py-1.5',
          chosen ? 'bg-teal-soft text-ink shadow-xs' : 'text-ink hover:bg-hover active:bg-pressed',
        )}
      >
        <Icon aria-hidden className={cn('size-4.5 shrink-0', chosen ? 'text-teal-strong' : 'text-ink-2')} />
        <span className="min-w-0 flex-1 type-label leading-tight text-balance">{way.name}</span>
        {compact ? null : (
          <ChevronRight
            aria-hidden
            className={cn('hidden size-4 shrink-0 @min-[52rem]:block', chosen ? 'text-ink' : 'text-ink-3')}
          />
        )}
      </button>
    </motion.li>
  );
}

export function Chooser({
  platform,
  chosen,
  onChoose,
  controls,
  compact = false,
}: {
  readonly platform: Platform;
  readonly chosen: WayId;
  readonly onChoose: (id: WayId) => void;
  /** The panel the ways show (aria-controls). */
  readonly controls: string;
  readonly compact?: boolean;
}) {
  const groups = groupsOn(platform);
  return (
    <MotionConfig reducedMotion="user">
      <div role="group" aria-label="Ways to import" className="flex flex-col gap-4">
        {compact ? null : (
          <header className="flex flex-col gap-1">
            <h3 className="m-0 type-page-title text-ink">Import</h3>
            <p className="m-0 type-body text-ink-2">
              Choose where your footage is. You’ll review it before anything is imported.
            </p>
          </header>
        )}
        <AnimatePresence initial={false} mode="popLayout">
          {groups.map((group) => (
            <motion.section
              key={group.title}
              layout="position"
              aria-label={group.title}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
              className="flex flex-col gap-1.5"
            >
              <h4 className="m-0 px-3 type-caption font-semibold text-ink-2">{group.title}</h4>
              <ul
                className={cn(
                  'm-0 grid list-none gap-0.5 p-0',
                  compact ? 'grid-cols-2 @min-[40rem]:grid-cols-1' : 'grid-cols-2 @min-[52rem]:grid-cols-1',
                )}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {group.ways.map((id) => (
                    <WayRow
                      key={id}
                      id={id}
                      chosen={id === chosen}
                      compact={compact}
                      controls={controls}
                      onChoose={onChoose}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {platform === 'ubuntu' ? (
            <motion.p
              key="mac-only"
              data-slot="icon-text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
              className="m-0 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 type-meta text-ink-2"
            >
              <span aria-hidden className="inline-flex h-[1lh] shrink-0 items-center">
                <BrandIcon id="apple" className="size-3.5" />
              </span>
              <span>On a Mac, also {listWords(MAC_ONLY)}.</span>
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
