// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the scrubber's filmstrip · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.5 · the clip as a continuous strip of its own frames across its length, as many as fit at
 *   the strip's height and the clip's shape, each the sprite frame nearest its moment (made at import by
 *   media.filmstrip, round 2: never sampled from the video, never the shots' best frames standing in). Cuts are
 *   canvas hairlines over the frames; under each shot a 2 px edge in its kind's colour (shot-kinds.ts: a data mark,
 *   its word is on the chip above)
 * states: drawn (the frames fade in once the sprite has loaded) · making (a neutral spinner: background work, never
 *   violet) · next in line · waiting for the copy to play, its turn or the library's reason · the copy couldn't be
 *   made · failed (the danger icon and the cause; Try again is in the status beside) · not needed (why) · let go to
 *   save space, being made again · didn't load. Each is the empty frame (dashed rule-strong on sunken) with one line
 *   in ink-2 · interactive n/a (the scrubber around it is the control)
 * motion: the frames' opacity over --dur-short on --ease-out; reduced motion: a 150 ms fade (base.css)
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { cn, errorMessage } from '@taalcut/ui';
import { CircleAlert, Clock, LoaderCircle, Minus } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaUrls } from '../../../../services/provider';
import { indexingReasonText } from '../../indexing-messages';
import { fractionOf, type ShotSpan } from '../clip-time';
import type { FilmstripState } from './filmstrip-state';
import { shotMark } from './shot-kinds';
import { frameStyle, frameTimesMs, nearestFrame, useSpriteLoad } from './sprite';

/** The strip's height in CSS pixels (h-14). */
const STRIP_HEIGHT = 56;
/** The narrowest frame slot, in CSS pixels (media's filmstrip counts its frames for the same). */
const NARROWEST_SLOT = 24;

function useSlots(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ count: 0, slot: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const width = element.clientWidth;
      const count = Math.max(1, Math.ceil(width / Math.max(NARROWEST_SLOT, STRIP_HEIGHT * ratio)));
      setSize({ count, slot: width / count });
    };
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [ratio]);
  return { ref, ...size };
}

type Drawn = Extract<FilmstripState, { kind: 'drawn' }>;

/** One box per slot, each showing the sprite frame nearest its middle. */
function SpriteFrames({
  strip,
  src,
  count,
  slot,
  length,
}: {
  strip: Drawn['filmstrip'];
  src: string;
  count: number;
  slot: number;
  length: number;
}) {
  const times = useMemo(() => frameTimesMs(strip), [strip]);
  return Array.from({ length: count }, (_, index) => {
    const frame = nearestFrame(times, ((index + 0.5) / count) * length);
    return (
      <span
        key={index}
        data-frame={frame}
        className="h-full min-w-0 flex-1"
        style={frameStyle(strip, src, frame, { width: slot, height: STRIP_HEIGHT })}
      />
    );
  });
}

const ICON = 'size-3.5 shrink-0';
const WAITING = <Clock aria-hidden className={cn(ICON, 'text-ink-3')} />;

/** Until the sprite shows: where media.filmstrip is, in one line. */
function stateLine(
  i18n: I18n,
  state: Exclude<FilmstripState, Drawn> | { kind: 'broken' },
): [ReactNode, string] {
  const said = (reasonKey: string | undefined) =>
    reasonKey ? indexingReasonText(i18n, reasonKey) : undefined;
  switch (state.kind) {
    case 'making':
      return [
        <LoaderCircle aria-hidden className={cn(ICON, 'animate-spin text-ink-2')} />,
        i18n._(msg`Laying out this clip’s frames…`),
      ];
    case 'next':
      return [WAITING, i18n._(msg`This clip’s frames are next.`)];
    case 'afterCopy':
      return [WAITING, i18n._(msg`The frames come once the copy to play is made.`)];
    case 'noCopy':
      return [
        <Minus aria-hidden className={cn(ICON, 'text-ink-3')} />,
        i18n._(msg`No frames: Taalcut couldn’t make a copy of this clip to play.`),
      ];
    case 'waiting':
      return [WAITING, said(state.reasonKey) ?? i18n._(msg`Waiting to lay out the frames.`)];
    case 'failed': {
      const cause = state.error ? ` ${errorMessage(i18n, state.error)}` : '';
      return [
        <CircleAlert aria-hidden className={cn(ICON, 'text-danger-strong')} />,
        `${i18n._(msg`Taalcut couldn’t lay out the frames.`)}${cause}`,
      ];
    }
    case 'skipped':
      return [
        <Minus aria-hidden className={cn(ICON, 'text-ink-3')} />,
        said(state.reasonKey) ?? i18n._(msg`This clip has no frames to lay out.`),
      ];
    case 'again':
      return [WAITING, i18n._(msg`The frames were let go to save space. They’re made again now.`)];
    case 'broken':
      return [
        <CircleAlert aria-hidden className={cn(ICON, 'text-danger-strong')} />,
        i18n._(msg`This clip’s frames didn’t load.`),
      ];
  }
}

export interface ClipFilmstripProps {
  /** Null for the skeleton's stand-in: the empty frame alone. */
  state: FilmstripState | null;
  spans: readonly ShotSpan[];
  length: number;
  ratio: number;
}

export const ClipFilmstrip = memo(function ClipFilmstrip({
  state,
  spans,
  length,
  ratio,
}: ClipFilmstripProps) {
  const { i18n } = useLingui();
  const media = useMediaUrls();
  const { ref, count, slot } = useSlots(ratio);
  const drawn = state?.kind === 'drawn' ? state : null;
  const src = drawn ? media.derived(drawn.filmstrip.file) : null;
  const load = useSpriteLoad(src);
  const shown = drawn && src && load !== 'broken' ? { strip: drawn.filmstrip, src } : null;
  const line =
    state === null || shown ? null : stateLine(i18n, state.kind === 'drawn' ? { kind: 'broken' } : state);
  return (
    <div
      ref={ref}
      data-slot="clip-filmstrip"
      data-state={shown ? 'drawn' : drawn ? 'broken' : (state?.kind ?? 'none')}
      className={cn(
        'relative h-14 overflow-hidden rounded-md',
        shown ? 'bg-viewer' : 'border border-dashed border-rule-strong bg-sunken',
      )}
    >
      {shown ? (
        <div
          data-ready={load === 'ready' || undefined}
          className="absolute inset-0 flex opacity-0 transition-opacity duration-(--dur-short) ease-(--ease-out) data-[ready]:opacity-100"
        >
          <SpriteFrames strip={shown.strip} src={shown.src} count={count} slot={slot} length={length} />
        </div>
      ) : null}
      {line ? (
        <p
          data-slot="clip-filmstrip-state"
          className="absolute inset-0 m-0 flex items-center gap-2 px-3 type-meta text-ink-2"
        >
          {line[0]}
          {/* Three lines of type-meta fit the strip's 56 px: a long cause in a long language, on the page grid's
              narrower column at the smallest window, isn't cut (kept from the shell's stopgap, UX4). */}
          <span className="line-clamp-3 min-w-0">{line[1]}</span>
        </p>
      ) : null}
      {spans.map((span) => {
        const left = fractionOf(span.from, length) * 100;
        const width = Math.max(0, fractionOf(span.to, length) * 100 - left);
        return (
          <span
            key={span.shot.id}
            aria-hidden
            className="absolute inset-y-0"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {shown && span.index > 0 ? (
              <span className="absolute inset-y-0 left-0 w-px bg-viewer-ink/85" />
            ) : null}
            <span className={cn('absolute inset-x-px bottom-0 h-0.5', shotMark(span.shot.shotType))} />
          </span>
        );
      })}
    </div>
  );
});
