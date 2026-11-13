// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the scrubber's lanes · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.5
 * under the filmstrip, what the clip holds over time, each lane named by its icon in the gutter and coloured by its
 *   job on this page: what's said as teal blocks carrying their words, the text on screen as violet blocks carrying
 *   theirs, the sound as a teal waveform with the part already played in the strong tone and the music's beats as
 *   rose ticks (downbeats taller). The block under the playhead takes the full tone. Words are always there: the
 *   colour is never the only sign
 * states: filled · the block at the playhead (full tone) · a lane with nothing in it isn't drawn (the inspector says
 *   what is still to come) · interactive n/a (the scrubber around them takes the pointer and the keys)
 * contrast: block words -strong on -soft ≥ 4.5:1; the full tone's -ink on its fill ≥ 4.5:1
 */
import type { AssetDetail } from '@taalcut/core';
import { cn, UserContent } from '@taalcut/ui';
import { memo, useCallback, useMemo } from 'react';
import { fractionOf, msOf, type TextSpan } from '../clip-time';
import { useClockValue, type ClipClock } from '../player/clip-clock';

const TONES = {
  speech: {
    block: cn('bg-teal-soft text-teal-strong'),
    current: cn('data-[current]:bg-teal data-[current]:text-teal-ink'),
  },
  text: {
    block: cn('bg-violet-soft text-violet-strong'),
    current: cn('data-[current]:bg-violet data-[current]:text-violet-ink'),
  },
};

function place(from: number, to: number, length: number) {
  const left = fractionOf(from, length) * 100;
  return { left: `${left}%`, width: `${Math.max(0, fractionOf(to, length) * 100 - left)}%` };
}

export interface WordsLaneProps {
  kind: keyof typeof TONES;
  spans: readonly TextSpan[];
  length: number;
  clock: ClipClock;
}

/** What's said, or the text on screen: a block per stretch with its words, the one at the playhead in full tone. */
export const WordsLane = memo(function WordsLane({ kind, spans, length, clock }: WordsLaneProps) {
  const select = useCallback(
    (at: number) => spans.findIndex((span) => span.from <= at && at < span.to),
    [spans],
  );
  const current = useClockValue(clock, select);
  const tone = TONES[kind];
  return (
    <div aria-hidden data-slot={`clip-${kind}-lane`} className="relative h-5">
      {spans.map((span, index) => (
        <span
          key={index}
          data-current={index === current || undefined}
          className={cn(
            'absolute inset-y-0.5 overflow-hidden rounded-sm px-1 text-2xs leading-4 font-medium whitespace-nowrap',
            'transition-colors duration-(--dur-micro) ease-(--ease-out)',
            tone.block,
            tone.current,
          )}
          style={place(span.from, span.to, length)}
        >
          {/* The words as said or shown, cut to their stretch: all of them in its tooltip. */}
          <span className="block truncate" title={span.text} translate="no">
            <UserContent translate="no">{span.text}</UserContent>
          </span>
        </span>
      ))}
    </div>
  );
});

/** A mirrored peak envelope: one point a bucket along the top, back along the bottom. */
export function waveformPath(peaks: readonly number[]): string {
  if (peaks.length === 0) return '';
  const top = peaks.map((peak, index) => `${index},${(50 - Math.max(0.02, peak) * 50).toFixed(1)}`);
  const bottom = peaks
    .map((peak, index) => `${index},${(50 + Math.max(0.02, peak) * 50).toFixed(1)}`)
    .reverse();
  return `M${top.join('L')}L${bottom.join('L')}Z`;
}

export interface SoundLaneProps {
  waveform: NonNullable<AssetDetail['waveform']>;
  beats: AssetDetail['beats'];
  length: number;
}

function Wave({ path, width, className }: { path: string; width: number; className: string }) {
  return (
    <svg
      viewBox={`0 0 ${Math.max(1, width - 1)} 100`}
      preserveAspectRatio="none"
      className={cn('absolute inset-0 size-full', className)}
    >
      <path d={path} className="fill-current" />
    </svg>
  );
}

/**
 * The sound as a waveform, the part before the playhead in the strong tone: a second copy cut at the playhead (--at,
 * set by the scrubber). Cut rather than moved, so nothing reaches past the lane.
 */
export const SoundLane = memo(function SoundLane({ waveform, beats, length }: SoundLaneProps) {
  const { peaks, bucketsPerSecond } = waveform;
  const path = useMemo(() => waveformPath(peaks), [peaks]);
  // The peaks may stop short of the clip's end (the last bucket): draw them over the time they cover.
  const covered = Math.min(1, peaks.length / bucketsPerSecond / Math.max(0.001, length / 1000)) * 100;
  const downbeats = useMemo(() => new Set(beats?.downbeats ?? []), [beats]);
  return (
    <div aria-hidden data-slot="clip-sound-lane" className="relative h-8">
      <div className="absolute inset-y-0 left-0" style={{ width: `${covered}%` }}>
        <Wave path={path} width={peaks.length} className="text-teal opacity-40" />
      </div>
      <div className="absolute inset-0" style={{ clipPath: 'inset(0 calc((1 - var(--at, 0)) * 100%) 0 0)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${covered}%` }}>
          <Wave path={path} width={peaks.length} className="text-teal-strong" />
        </div>
      </div>
      {beats?.beats.map((beat, index) => (
        <span
          key={index}
          data-downbeat={downbeats.has(index) || undefined}
          className="absolute bottom-0 h-1.5 w-px bg-beat-strong data-[downbeat]:h-2.5"
          style={{ left: `${fractionOf(msOf(beat), length) * 100}%` }}
        />
      ))}
    </div>
  );
});
