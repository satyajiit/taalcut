// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the editor's timeline · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Timeline: clips are neutral blocks on
 *   the sunken bed; AI picks a violet bottom edge, the one place a coloured edge is allowed; a trim moves an edge
 *   and changes no colour, since teal marks only a swap, a move or a slip; beats are rose ticks; the playhead a
 *   marigold line)
 * rebuilt lean from apps/renderer/src/features/timeline/{clip-block,video-track,ruler,beat-lane,playhead-line,
 *   captions-lane}.tsx: the seconds, the clips (a label strip with the number and name over a filmstrip of the
 *   owner's footage; a listbox: ← → choose, Home End, [ a beat shorter, ] a beat longer, as the app's keys.ts), the
 *   captions word by word, the music beats, and the playhead over them
 * states: clip default · hover (the strip takes the hover surface) · focus (base ring, roving) · active (pressed) ·
 *   selected (marigold ring inside, selection wash on the strip) · AI pick (violet edge) · trimmed (the edge moved,
 *   said in its name) · disabled n/a · loading (the viewer grey until the frames load) · error n/a (sample) ·
 *   captions: the word being said (ink) and the rest (ink-2)
 * motion: the playhead moves by transform while the cut plays (the visitor's Play, with Pause); nothing else moves */

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { Filmstrip } from '../frame';
import { filmstripCount, framesOf } from '../frames';
import { formatTime, pct } from '../timecode';
import { CAPTIONS, CLIPS, clipSpan, edgeTime, type Cut } from './cut';

export interface EditorTimelineProps {
  readonly cut: Cut;
  /** The clips whose end you moved: still the AI's pick. */
  readonly trimmed: ReadonlySet<number>;
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onTrim: (index: number, by: number) => void;
  /** The playhead, in seconds. */
  readonly at: number;
  readonly compact?: boolean;
}

export function EditorTimeline({ cut, trimmed, selected, onSelect, onTrim, at, compact = false }: EditorTimelineProps) {
  const strip = useRef<HTMLDivElement>(null);
  const { duration, beats } = cut;
  const count = cut.edges.length - 1;
  const marks = Array.from({ length: Math.floor(duration / 2) + 1 }, (_, i) => i * 2);

  const focusClip = (index: number) => {
    onSelect(index);
    strip.current?.querySelector<HTMLElement>(`[data-clip="${index}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    // [ and ] trim, as in the app; with ⌘ or Ctrl they are the window's Back and Forward, never a trim.
    if ((key === '[' || key === ']') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      onTrim(selected, key === ']' ? 1 : -1);
      return;
    }
    const moves: Record<string, number> = { ArrowRight: Math.min(count - 1, selected + 1), ArrowLeft: Math.max(0, selected - 1), Home: 0, End: count - 1 };
    const target = moves[key];
    if (target === undefined) return;
    event.preventDefault();
    focusClip(target);
  };

  return (
    <div className="relative flex flex-col gap-1.5 rounded-xl bg-sunken p-2">
      <div aria-hidden className="relative h-4">
        {marks.map((second, i) => (
          <span
            key={second}
            className={cn('absolute top-0 tc-mono type-caption text-ink-3', i === 0 ? '' : second >= duration - 0.5 ? '-translate-x-full' : '-translate-x-1/2', i % 2 === 1 && 'max-sm:hidden')}
            style={{ left: pct(second, duration) }}
          >
            {formatTime(second, false)}
          </span>
        ))}
      </div>
      <div ref={strip} role="listbox" aria-label="Clips" aria-orientation="horizontal" onKeyDown={onKeyDown} className={cn('relative', compact ? 'h-11' : 'h-14')}>
        {CLIPS.slice(0, count).map((clip, i) => {
          const [start, end] = clipSpan(cut, i);
          const cutDown = trimmed.has(i);
          const chosen = i === selected;
          return (
            <span
              key={clip.id}
              role="option"
              aria-selected={chosen}
              aria-label={`Clip ${i + 1} ${clip.word}, ${formatTime(start)} to ${formatTime(end)}, AI pick${cutDown ? ', trimmed' : ''}`}
              data-clip={i}
              data-by="ai"
              data-trimmed={cutDown || undefined}
              tabIndex={chosen ? 0 : -1}
              onClick={() => focusClip(i)}
              className="group absolute inset-y-0 cursor-pointer px-px outline-offset-1"
              style={{ left: pct(start, duration), width: pct(end - start, duration) }}
            >
              <span className="@container relative flex size-full flex-col overflow-hidden rounded-clip border border-rule-subtle bg-raised">
                <span
                  className={cn(
                    'flex h-4 shrink-0 items-center gap-1 px-1.5 type-caption leading-none whitespace-nowrap',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out) group-active:bg-pressed',
                    chosen ? 'bg-selected text-ink' : 'text-ink-2 group-hover:bg-hover',
                  )}
                >
                  {/* A space parts the number and the name, so what the strip shows ("3 Temple flags") is in its name (2.5.3). */}
                  <span className="tabular-nums">{i + 1}</span>{' '}
                  <span className="hidden min-w-0 truncate @[5.5rem]:inline">{clip.word}</span>
                </span>
                <Filmstrip sprites={framesOf(clip.clipId)} count={filmstripCount((end - start) / duration, compact ? 72 : 52)} className="flex-1" />
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-ai-strong" />
                {chosen ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-clip ring-2 ring-primary-strong ring-inset" /> : null}
              </span>
            </span>
          );
        })}
      </div>
      {compact ? null : (
        <ul aria-label="Captions, word by word" className="relative m-0 h-7 list-none p-0">
          {CAPTIONS.map((line) => {
            const first = line[0];
            const last = line[line.length - 1];
            if (!first || !last) return null;
            const span = last.end - first.start;
            return (
              <li
                key={first.text + first.start}
                aria-label={`${line.map((w) => w.text).join(' ')}, from ${formatTime(first.start)}`}
                className="absolute inset-y-0 flex items-center overflow-hidden rounded-sm border border-rule-subtle bg-raised"
                style={{ left: pct(first.start, duration), width: pct(span, duration) }}
              >
                <span aria-hidden className="block min-w-0 truncate px-1.5 type-caption text-ink-2">
                  {line.map((word, w) => (
                    <span key={word.start}>
                      {w > 0 ? ' ' : null}
                      <span className={cn(at >= word.start && at < word.end && 'rounded-sm bg-hover text-ink')}>{word.text}</span>
                    </span>
                  ))}
                </span>
                {line.slice(1).map((word) => (
                  <span key={word.start} aria-hidden className="absolute bottom-0 h-1.5 w-px bg-rule-strong" style={{ left: `${((word.start - first.start) / span) * 100}%` }} />
                ))}
              </li>
            );
          })}
        </ul>
      )}
      <div aria-hidden className="relative h-3">
        {beats.map((beat, i) => (
          <span key={beat} className={cn('absolute top-0 w-px rounded-pill', i % 4 === 0 ? 'h-3 bg-beat-strong' : 'h-1.5 bg-beat')} style={{ left: pct(beat, duration) }} />
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-2 inset-y-1 overflow-hidden">
        <span className="absolute inset-0 block" style={{ transform: `translateX(${(Math.min(at, duration) / duration) * 100}%)` }}>
          <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-px rounded-pill bg-playhead-strong" />
        </span>
      </div>
      <span className="sr-only">Playhead at {formatTime(at)}, the cut is {formatTime(edgeTime(cut, cut.edges[count] ?? 0))} long.</span>
    </div>
  );
}
