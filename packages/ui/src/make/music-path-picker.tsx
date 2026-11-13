// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: the export's music (REF1) · system: DESIGN.md v0.7 (Switch with its words,
 *   Collapse, hairline radio rows)
 * the owner's decision of 2026-10-29: the reel's music is in the export by default. A switch, "Music in the video",
 *   with its one line: Instagram and YouTube may mute music added outside their apps. On: which music, as hairline
 *   radio rows, the reel's music first (its sound as the platform named it) and your own track. Off: no music in the
 *   file, and the add-this-sound steps with the reel's link (add-sound-steps.tsx). Turning it on again brings back
 *   the music it had. There is no warning before the reel's music any more
 * states: on · off (the steps) · hover (hover surface) · focus (base ring; the rows roving, instant) · active
 *   (pressed) · checked (ink dot) · disabled (a row that isn't available says why; the switch when there's no music
 *   to turn on; everything while an answer is in flight) · loading/error/success: the caller's (it disables the
 *   picker, says why under it; success is the row checked)
 * contrast: the rows' words in ink, their lines in ink-2 (7:1); the switch's own
 * motion: the regions open and close with the kit's Collapse (height through grid rows, the content fading;
 *   reduced motion: at once, a fade) when the person turns the switch; music that arrives with the video (a page
 *   loading the timeline after its card) shows at once, so nothing moves on its own */
import { useLingui } from '@lingui/react/macro';
import type { MusicPath, Platform, PlatformSoundSteps } from '@taalcut/core';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Collapse } from '#components/collapse';
import { Switch } from '#components/switch';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { AddSoundSteps } from './add-sound-steps';

export interface MusicPathPickerProps {
  value: MusicPath;
  /** The music chosen; `platformSound` when the switch turns it off. No acknowledgement since REF1. */
  onChange: (path: MusicPath) => void | Promise<unknown>;
  /** Whether the reel's music is kept with this video's template (REF1: no warning stands before it). */
  referenceAudio: { readonly available: boolean };
  ownTrack: { readonly available: boolean };
  /** What adding the sound in the app takes: the reel's link and sound, and each app's steps; null without a reel. */
  platformSound?: PlatformSoundSteps | null;
  /** The app the export is for, whose steps show; null (a file for this Mac) lets the person pick the app. */
  platform?: Platform | null;
  disabled?: boolean;
  className?: string;
}

/** The music rows; generated music (P3-V6) has its own row in the export dialog, above this picker. */
const SOURCES = ['referenceAudio', 'ownTrack'] as const satisfies readonly MusicPath[];
type Source = (typeof SOURCES)[number];

const isSource = (path: MusicPath): path is Source => SOURCES.some((known) => known === path);

export function MusicPathPicker({
  value,
  onChange,
  referenceAudio,
  ownTrack,
  platformSound = null,
  platform = null,
  disabled = false,
  className,
}: MusicPathPickerProps) {
  const { t } = useLingui();
  const group = useRef<HTMLDivElement>(null);
  const on = value !== 'platformSound' && value !== 'none';
  const offPath = useRef<MusicPath>(value === 'none' ? 'none' : 'platformSound');
  const available: Record<Source, boolean> = {
    referenceAudio: referenceAudio.available,
    ownTrack: ownTrack.available,
  };
  // A video made without a reel (from a description, say) has no reel's music to offer, kept or not.
  const rows = SOURCES.filter(
    (path) => path !== 'referenceAudio' || available[path] || platformSound !== null,
  );
  // The music to bring back when the switch goes on again: the last one chosen, else the first there is.
  const [last, setLast] = useState<MusicPath | null>(on ? value : null);
  useEffect(() => {
    if (value !== 'platformSound' && value !== 'none') setLast(value);
    else offPath.current = value;
  }, [value]);
  const resume: MusicPath | null =
    last !== null && (last === 'generated' || (isSource(last) && available[last]))
      ? last
      : (SOURCES.find((source) => available[source]) ?? null);

  const credit = platformSound?.soundLabel ?? null;
  const words: Record<Source, { name: string; about: ReactNode; off: string }> = {
    referenceAudio: {
      name: t`The reel’s music`,
      about: credit ? (
        <UserContent translate="no" dir="auto">
          {credit}
        </UserContent>
      ) : (
        t`The music your cuts were timed to.`
      ),
      off: t`It isn’t kept with this template yet. Get the reel’s video and music on the template’s page.`,
    },
    ownTrack: {
      name: t`Your own track`,
      about: t`A song you have the rights to, under your clips.`,
      off: t`Ask Taalcut to use a song from your library first.`,
    },
  };

  // Motion answers the person: until they turn the switch, the regions follow the value without moving.
  const [moved, setMoved] = useState(false);
  const still = moved ? undefined : 'transition-none';
  const pick = (path: Source) => {
    if (disabled || !available[path] || path === value) return;
    void onChange(path);
  };
  const turn = (next: boolean) => {
    if (disabled) return;
    setMoved(true);
    if (!next) void onChange(offPath.current);
    else if (resume) void onChange(resume);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const usable = rows.filter((path) => available[path]);
    if (usable.length === 0) return;
    const at = isSource(value) ? Math.max(0, usable.indexOf(value)) : 0;
    const moves: Record<string, number> = {
      ArrowDown: (at + 1) % usable.length,
      ArrowRight: (at + 1) % usable.length,
      ArrowUp: (at - 1 + usable.length) % usable.length,
      ArrowLeft: (at - 1 + usable.length) % usable.length,
    };
    if (event.key in moves) {
      event.preventDefault();
      const next = usable[moves[event.key]!]!;
      group.current?.querySelector<HTMLElement>(`[data-music="${next}"]`)?.focus();
      pick(next);
    }
  };
  // With no row chosen (made music is), the first usable row takes the tab stop.
  const stop = isSource(value) ? value : rows.find((source) => available[source]);

  return (
    <div className={cn('flex flex-col gap-2', className)} data-slot="music-picker" data-music-on={on}>
      <Switch
        checked={on}
        onCheckedChange={turn}
        disabled={disabled || (!on && resume === null)}
        label={t`Music in the video`}
        description={
          value === 'none'
            ? t`Keep the source sound without adding music.`
            : t`Instagram and YouTube may mute music added outside their apps.`
        }
        data-slot="music-switch"
      />
      <Collapse open={on} className={still}>
        <div
          ref={group}
          role="radiogroup"
          aria-label={t`Music`}
          onKeyDown={onKeyDown}
          data-slot="music-path-picker"
          className="mt-1 flex flex-col border-t border-rule-subtle"
        >
          {rows.map((path) => {
            const checked = path === value;
            const off = disabled || !available[path];
            return (
              <button
                key={path}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={off || undefined}
                data-music={path}
                tabIndex={path === stop && !disabled && on ? 0 : -1}
                onClick={() => pick(path)}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-rule-subtle px-1 py-2.5 text-start last:border-b-0',
                  'transition-colors duration-(--dur-micro) ease-(--ease-out)',
                  off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover active:bg-pressed',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 grid size-4 shrink-0 place-items-center rounded-pill border',
                    off ? 'border-rule-subtle' : checked ? 'border-ink' : 'border-rule-strong',
                  )}
                >
                  {checked ? <span className="block size-2 rounded-pill bg-ink" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('type-label', off ? 'text-ink-disabled' : 'text-ink')}>
                    {words[path].name}
                  </span>
                  <span className="type-meta text-ink-2">
                    {available[path] ? words[path].about : words[path].off}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Collapse>
      {value !== 'none' ? (
        <Collapse open={!on} className={still}>
          <AddSoundSteps steps={platformSound} platform={platform} disabled={disabled} />
        </Collapse>
      ) : null}
    </div>
  );
}
