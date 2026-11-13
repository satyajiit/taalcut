// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: mini timeline · genre: atmospheric studio app · system: DESIGN.md v0.3 (Timeline: slots are
 *   neutral blocks on the sunken bed; beats are rose ticks below; the playhead is a marigold line; AI picks get a
 *   violet bottom edge; your swaps a teal wash and edge — the one place a coloured edge is allowed: data marks on
 *   timeline clips, never a container's stripe)
 * states: default (raised blocks with their frame) · hover (the block lifts to the hover surface under its frame) ·
 *   focus (base ring on the block, roving: arrows, Home, End; Return opens it) · active (pressed) · selected (marigold
 *   edge and selection wash) · locked (a lock in the block's corner, said in its name) · gap (dashed outline, empty)
 *   · disabled (no onSelectClip: a picture of the cut, one tab stop for reading names) · loading/error/success: the
 *   card's
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { Clip, Timeline, TimelineItemId } from '@taalcut/core';
import { Lock } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { beatTicks, chosenBy, placeVideo } from './timeline-math';
import { useTimecode } from './timecode';

export interface MiniTimelineProps {
  timeline: Timeline;
  /** Canvas frame of the playhead; undefined hides it. */
  playheadFrame?: number;
  selectedClipId?: TimelineItemId | null;
  onSelectClip?: (clipId: TimelineItemId) => void;
  /** Return or a click on a clip: open what it can do (the card's popover). */
  onActivateClip?: (clipId: TimelineItemId, element: HTMLElement) => void;
  /** A clip's frame URL; null keeps the block neutral. */
  frames?: (clip: Clip) => string | null | undefined;
  /** Shorter blocks for the export card's slot strip. */
  compact?: boolean;
  /** Dims the cut (an update in flight). */
  dimmed?: boolean;
  className?: string;
}

export function MiniTimeline({
  timeline,
  playheadFrame,
  selectedClipId = null,
  onSelectClip,
  onActivateClip,
  frames,
  compact = false,
  dimmed = false,
  className,
}: MiniTimelineProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const strip = useRef<HTMLDivElement>(null);
  const { items, total } = placeVideo(timeline);
  const clips = items.flatMap((item) => (item.kind === 'clip' ? [item] : []));
  const ticks = beatTicks(timeline, total);
  const rate = timeline.canvas.rate;
  const [focused, setFocused] = useState(0);
  const selectedAt = clips.findIndex((item) => item.clip.id === selectedClipId);
  const stop = selectedAt >= 0 ? selectedAt : Math.min(focused, Math.max(0, clips.length - 1));
  const pct = (frame: number) => `${(frame / Math.max(1, total)) * 100}%`;

  const focusClip = (index: number) => {
    const target = clips[index];
    if (!target) return;
    setFocused(index);
    onSelectClip?.(target.clip.id);
    strip.current?.querySelector<HTMLElement>(`[data-clip-id="${target.clip.id}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: Math.min(clips.length - 1, stop + 1),
      ArrowLeft: Math.max(0, stop - 1),
      Home: 0,
      End: clips.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusClip(moves[event.key]!);
    } else if (event.key === 'Enter' && onActivateClip) {
      const target = clips[stop];
      const el = target && strip.current?.querySelector<HTMLElement>(`[data-clip-id="${target.clip.id}"]`);
      if (target && el) {
        event.preventDefault();
        onActivateClip(target.clip.id, el);
      }
    }
  };

  return (
    <div
      data-slot="mini-timeline"
      className={cn(
        'relative flex flex-col gap-1.5 rounded-xl bg-panel p-2 transition-opacity duration-(--dur-short) ease-(--ease-out)',
        dimmed && 'opacity-60',
        className,
      )}
    >
      <div
        ref={strip}
        role="listbox"
        aria-label={t`Clips`}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className={cn('relative', compact ? 'h-9' : 'h-12')}
      >
        {items.map((item) => {
          if (item.kind === 'gap')
            return (
              <span
                key={item.id}
                aria-hidden
                className="absolute inset-y-0 px-px"
                style={{ left: pct(item.start), width: pct(item.frames) }}
              >
                <span className="block size-full rounded-clip border border-dashed border-rule" />
              </span>
            );
          const { clip, index } = item;
          const by = chosenBy(timeline, clip.id);
          const selected = clip.id === selectedClipId;
          const url = frames?.(clip) ?? null;
          const n = i18n.number(index);
          const at = time.clock(item.start, rate);
          const length = time.length(item.frames, rate);
          const who = by === 'you' ? t`your pick` : by === 'ai' ? t`AI pick` : '';
          const name = [t`Clip ${n}`, at, length, who, clip.locked ? t`locked` : '']
            .filter(Boolean)
            .join(', ');
          return (
            <span
              key={clip.id}
              role="option"
              aria-selected={selected}
              aria-label={name}
              data-clip-id={clip.id}
              tabIndex={index - 1 === stop ? 0 : -1}
              onClick={(event) => {
                setFocused(index - 1);
                if (onActivateClip) onActivateClip(clip.id, event.currentTarget);
                else onSelectClip?.(clip.id);
              }}
              className={cn(
                'group absolute inset-y-0 px-px outline-offset-1',
                onSelectClip || onActivateClip ? 'cursor-pointer' : 'cursor-default',
              )}
              style={{ left: pct(item.start), width: pct(item.frames) }}
            >
              <span
                className={cn(
                  'relative block size-full overflow-hidden rounded-clip border',
                  'transition-colors duration-(--dur-micro) ease-(--ease-out)',
                  selected
                    ? 'border-primary-strong bg-selected'
                    : 'border-rule-subtle bg-raised group-hover:bg-hover',
                  'group-active:bg-pressed',
                )}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    draggable={false}
                    decoding="async"
                    className={cn('absolute inset-0 size-full object-cover', selected && 'opacity-80')}
                  />
                ) : null}
                {by === 'you' ? <span aria-hidden className="absolute inset-0 bg-you-soft/45" /> : null}
                {by ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-x-0 bottom-0 h-[3px]',
                      by === 'you' ? 'bg-you-strong' : 'bg-ai-strong',
                    )}
                  />
                ) : null}
                {clip.locked ? (
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-0.5 grid size-3.5 place-items-center rounded-sm bg-raised"
                  >
                    <Lock className="size-2.5 text-ink-2" />
                  </span>
                ) : null}
              </span>
            </span>
          );
        })}
      </div>
      {ticks.length > 0 ? (
        <div aria-hidden className="relative h-2.5">
          {ticks.map((tick) => (
            <span
              key={tick.frame}
              className={cn(
                'absolute top-0 w-px rounded-pill bg-beat-strong',
                tick.downbeat ? 'h-2.5' : 'h-1.5',
              )}
              style={{ left: pct(tick.frame) }}
            />
          ))}
        </div>
      ) : null}
      {playheadFrame !== undefined ? (
        <span
          aria-hidden
          data-slot="playhead"
          className="pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-pill bg-playhead"
          style={{
            left: `calc(0.5rem + (100% - 1rem) * ${Math.min(1, playheadFrame / Math.max(1, total))})`,
          }}
        />
      ) : null}
    </div>
  );
}
