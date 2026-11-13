// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the shelf's sounds · mode: Operate · system: WEB2 Remix Vernacular (rose is the beat; teal is yours)
 * one row per sound, each with its own character: the reel it would cut (a 9:16 frame of the owner's clip its cut
 *   opens on), its title, who made it, its length and licence, and the row drawn as its waveform, every hook drop on
 *   a rose band with its time in seconds; the whole row chooses it (and plays it, the playhead running along its
 *   wave), and Save audio keeps it in Saved. Empty: the app's line and Clear filters.
 * states: row: default · hover (the row washes) · focus (base ring) · active (pressed) · chosen (raised, an ink edge,
 *   aria-pressed) · playing (the playhead along the row, the bars behind it darken) · Save audio: default · hover ·
 *   focus · saved (teal, aria-pressed) · empty (one line and Clear filters)
 * motion: a new list rises 4 px and fades in (--dur-short); reduced motion: at once */

import { Bookmark, BookmarkCheck, ListFilter } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import type { Sound } from './sounds';
import { RowWave } from './waveform';

const LICENCE_CHIP = { royalty_free: 'Royalty-free', licensed: 'Licensed', original: null } as const;

function SoundRow({
  sound,
  chosen,
  at,
  saved,
  onChoose,
  onSave,
  compact,
}: {
  readonly sound: Sound;
  readonly chosen: boolean;
  /** Its playhead while it plays; null otherwise. */
  readonly at: number | null;
  readonly saved: boolean;
  readonly onChoose: () => void;
  readonly onSave: () => void;
  readonly compact: boolean;
}) {
  const licence = LICENCE_CHIP[sound.licence];
  return (
    <li
      data-sound={sound.id}
      data-chosen={chosen || undefined}
      className={cn(
        'relative flex items-stretch gap-3 rounded-xl border p-2 transition-colors duration-(--dur-micro) ease-(--ease-out)',
        chosen ? 'border-ink-3 bg-raised shadow-xs' : 'border-transparent hover:bg-hover',
      )}
    >
      <ClipFrame sprite={frameOf(sound.clipId)} className={cn('shrink-0 self-start rounded-lg', compact ? 'w-10' : 'w-12')} />
      {/* The whole row chooses the sound: its title is the button, stretched over the row by ::after (the stretched
          link pattern), so the button's name is exactly the words it shows. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-pressed={chosen}
            onClick={onChoose}
            className={cn(
              'block min-w-0 truncate text-start type-card-title text-ink',
              'after:absolute after:inset-0 after:rounded-xl active:after:bg-pressed/40',
              'focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus',
            )}
          >
            {sound.title}
          </button>
          {licence && !compact ? <Chip tone={sound.licence === 'royalty_free' ? 'you' : 'neutral'}>{licence}</Chip> : null}
        </span>
        <span className="truncate type-meta text-ink-2">
          {sound.artist} · <span className="tabular-nums">{Math.round(sound.durationSec)} s</span>
        </span>
        <RowWave sound={sound} at={at} bars={compact ? 36 : 44} className="me-1" />
      </span>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={`Save audio: ${sound.title}`}
        title={saved ? 'Saved' : 'Save audio'}
        onClick={onSave}
        className={cn(
          'relative z-10 inline-grid size-9 shrink-0 place-items-center self-start rounded-pill transition-colors duration-(--dur-micro) ease-(--ease-out) active:bg-pressed',
          saved ? 'bg-teal-soft text-teal-strong' : 'text-ink-2 hover:bg-control-hover hover:text-ink',
        )}
      >
        {saved ? <BookmarkCheck aria-hidden className="size-4" /> : <Bookmark aria-hidden className="size-4" />}
      </button>
    </li>
  );
}

export function SoundList({
  id,
  sounds,
  listKey,
  fresh,
  chosen,
  at,
  saved,
  onChoose,
  onSave,
  onClear,
  labelledBy,
  reduce,
  compact = false,
}: {
  readonly id?: string;
  readonly sounds: readonly Sound[];
  /** Changes when the tab or a filter does, so the new list rises in. */
  readonly listKey: string;
  /** Whether the list changed in this browser (the server's list never rises). */
  readonly fresh: boolean;
  readonly chosen: string;
  /** The chosen sound's playhead while it plays; null otherwise. */
  readonly at: number | null;
  readonly saved: ReadonlySet<string>;
  readonly onChoose: (id: string) => void;
  readonly onSave: (id: string) => void;
  readonly onClear?: () => void;
  readonly labelledBy?: string;
  readonly reduce: boolean;
  readonly compact?: boolean;
}) {
  return (
    <div id={id} role={labelledBy ? 'tabpanel' : undefined} aria-labelledby={labelledBy} className="min-w-0">
      {sounds.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule-subtle bg-sunken px-4 py-3">
          <p className="m-0 type-body text-ink-2">No tracks in this view match your filter.</p>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 type-label-sm text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed"
            >
              <ListFilter aria-hidden className="size-4" />
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <motion.ul
          key={listKey}
          aria-label="Trending Instagram audio tracks"
          initial={fresh && !reduce ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0.15 : DUR.short, ease: EASE_OUT }}
          className="m-0 flex list-none flex-col gap-1.5 p-0"
        >
          {sounds.map((sound) => (
            <SoundRow
              key={sound.id}
              sound={sound}
              chosen={sound.id === chosen}
              at={sound.id === chosen ? at : null}
              saved={saved.has(sound.id)}
              onChoose={() => onChoose(sound.id)}
              onSave={() => onSave(sound.id)}
              compact={compact}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}
