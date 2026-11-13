// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip's scrubber · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.5
 * the clip across the width, as an editor's: its shots as kind chips, its frames as a continuous filmstrip, then
 *   lanes for what's said, the text on screen and the sound with its beats, a ruler under them, each lane named by
 *   an icon in its colour in the gutter. The marigold playhead runs through them all. The whole stack is one
 *   slider: pressing anywhere goes there, dragging scrubs with the video following, hovering shows the frame there
 * states: default · hover (the frame and time under the pointer; the cursor a resize arrow) · focus (the base ring
 *   on the stack, instant) · active (dragging: the playhead follows the pointer at once, playing pauses and picks up
 *   again on release) · disabled n/a (a clip without a length has no scrubber) · loading (the filmstrip's frames fade
 *   in once its sprite has loaded) · until the filmstrip is made, it says where media.filmstrip is (making, waiting,
 *   failed with its cause: clip-filmstrip.tsx); scrubbing and the playhead work all the same, from the video ·
 *   success n/a
 * keys (as a slider, aria-valuetext "0:02.40 of 0:06.10, shot 2 of 4"): ← → a frame · ⇧← ⇧→ a shot · Page Up/Down a
 *   second · Home · End; Space, J K L as everywhere on the page
 * motion: a jump (a press, a key, a shot, a line) glides the playhead over --dur-short on --ease-out; while it
 *   plays or is dragged it follows at once; transform only; reduced motion: at once
 */
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { cn, DUR, useFormatters, useTimecode } from '@taalcut/ui';
import { AudioWaveform, Film, MessageSquareText, Type } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { fractionOf, rulerMarks, shotAt, timeAtX, type ShotSpan, type TextSpan } from '../clip-time';
import type { ClipPlayer } from '../player/use-clip-player';
import { ClipFilmstrip } from './clip-filmstrip';
import type { FilmstripState } from './filmstrip-state';
import { ClipShotChips } from './clip-shot-chips';
import { ScrubHover } from './scrub-hover';
import { SoundLane, WordsLane } from './scrub-lanes';

const MS = { num: 1000, den: 1 } as const;

export interface ClipScrubberProps {
  player: ClipPlayer;
  /** What the filmstrip shows (filmstrip-state.ts); null for the skeleton's stand-in. */
  filmstrip: FilmstripState | null;
  spans: readonly ShotSpan[];
  speech: readonly TextSpan[];
  text: readonly TextSpan[];
  waveform: AssetDetail['waveform'];
  beats: AssetDetail['beats'];
  ratio: number;
  /** A jump: the playhead glides there. */
  onSeek: (at: number) => void;
  onStepShot: (direction: -1 | 1) => void;
  /** Set by a jump made elsewhere (a shot, a line, a button), so the playhead glides to it. */
  glide: RefObject<boolean>;
  /** Said where the shots go when there are none yet. */
  noShots: ReactNode;
}

function Gutter({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <span title={label} className={cn('flex items-center justify-center', className)}>
      {children}
    </span>
  );
}

export function ClipScrubber(props: ClipScrubberProps) {
  const {
    player,
    filmstrip,
    spans,
    speech,
    text,
    waveform,
    beats,
    ratio,
    onSeek,
    onStepShot,
    glide,
    noShots,
  } = props;
  const { t } = useLingui();
  const timecode = useTimecode();
  const format = useFormatters();
  const { clock, length } = player;
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<{ x: number; at: number } | null>(null);
  const [width, setWidth] = useState(0);

  // The playhead's place (--at) and the slider's value follow the clock without re-rendering the lanes.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const say = (at: number) => {
      const shot = shotAt(spans, at);
      const now = timecode.clock(Math.round(at), MS, { fraction: true });
      const total = timecode.clock(Math.round(length), MS, { fraction: true });
      const number = (shot?.index ?? 0) + 1;
      const count = spans.length;
      element.setAttribute('aria-valuenow', String(Math.round(at)));
      element.setAttribute(
        'aria-valuetext',
        shot ? t`${now} of ${total}, shot ${number} of ${count}` : t`${now} of ${total}`,
      );
    };
    const follow = () => {
      const at = clock.get();
      element.style.setProperty('--at', String(fractionOf(at, length)));
      if (glide.current) {
        glide.current = false;
        element.dataset['glide'] = '';
        clearTimeout(timer);
        timer = setTimeout(() => delete element.dataset['glide'], DUR.short * 1000 + 40);
      }
      say(at);
    };
    follow();
    const stop = clock.subscribe(follow);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [clock, length, spans, timecode, glide, t]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const timeOf = (event: PointerEvent<HTMLElement>) =>
    timeAtX(event.currentTarget.getBoundingClientRect(), event.clientX, length);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    dragging.current = true;
    setHover(null);
    player.grab();
    onSeek(timeOf(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) return player.seek(timeOf(event));
    if (event.pointerType === 'mouse') {
      const box = event.currentTarget.getBoundingClientRect();
      setHover({ x: event.clientX - box.left, at: timeOf(event) });
    }
  };
  const letGo = () => {
    if (!dragging.current) return;
    dragging.current = false;
    player.release();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = clock.get();
    const jump = (to: number) => {
      event.preventDefault();
      onSeek(to);
    };
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.shiftKey) onStepShot(direction);
      else player.stepFrame(direction);
    } else if (event.key === 'PageUp') jump(at + 1000);
    else if (event.key === 'PageDown') jump(at - 1000);
    else if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(length);
  };

  return (
    <section
      aria-label={t`Timeline`}
      data-slot="clip-scrubber"
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 gap-y-1"
    >
      <span aria-hidden />
      {spans.length > 0 ? (
        <ClipShotChips spans={spans} length={length} width={width} clock={clock} onSeek={onSeek} />
      ) : (
        <p className="m-0 flex h-6 items-center text-2xs text-ink-3">{noShots}</p>
      )}
      <div aria-hidden className="flex flex-col gap-1 text-ink-3 [&_svg]:size-3.5">
        <Gutter label={t`Frames`} className="h-14">
          <Film />
        </Gutter>
        {speech.length > 0 ? (
          <Gutter label={t`What’s said`} className="h-5 text-teal-strong">
            <MessageSquareText />
          </Gutter>
        ) : null}
        {text.length > 0 ? (
          <Gutter label={t`Text on screen`} className="h-5 text-violet-strong">
            <Type />
          </Gutter>
        ) : null}
        {waveform ? (
          <Gutter label={t`Sound`} className="h-8 text-teal-strong">
            <AudioWaveform />
          </Gutter>
        ) : null}
      </div>
      <div
        ref={root}
        role="slider"
        tabIndex={0}
        aria-label={t`Playhead`}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-orientation="horizontal"
        data-slot="clip-scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className="group/scrub relative flex cursor-ew-resize touch-none flex-col gap-1 rounded-md select-none @container"
      >
        <ClipFilmstrip state={filmstrip} spans={spans} length={length} ratio={ratio} />
        {speech.length > 0 ? <WordsLane kind="speech" spans={speech} length={length} clock={clock} /> : null}
        {text.length > 0 ? <WordsLane kind="text" spans={text} length={length} clock={clock} /> : null}
        {waveform ? <SoundLane waveform={waveform} beats={beats} length={length} /> : null}
        <div aria-hidden data-slot="clip-ruler" className="relative h-4 border-t border-rule-subtle">
          {rulerMarks(length).map((at) => (
            <span
              key={at}
              className="absolute top-0 flex h-full items-start"
              style={{ left: `${fractionOf(at, length) * 100}%` }}
            >
              <span className="block h-1.5 w-px bg-rule" />
              <span className="ps-1 pt-0.5 text-2xs leading-none text-ink-3 tabular-nums">
                {format.duration(at)}
              </span>
            </span>
          ))}
        </div>
        {/* The playhead: a line with its head, centred in a box as wide as the head, so nothing sticks out. */}
        <span
          aria-hidden
          data-slot="clip-playhead"
          className="pointer-events-none absolute -top-1 bottom-4 left-0 z-10 w-2.5 group-data-[glide]/scrub:transition-transform group-data-[glide]/scrub:duration-(--dur-short) group-data-[glide]/scrub:ease-(--ease-out)"
          style={{ transform: 'translateX(calc(var(--at, 0) * 100cqw - 0.3125rem))' }}
        >
          <span className="absolute inset-y-0 left-1/2 block w-0.5 -translate-x-1/2 rounded-pill bg-playhead-strong" />
          <span className="absolute -top-0.5 left-0 block size-2.5 rounded-pill bg-playhead-strong" />
        </span>
        <ScrubHover
          hover={hover}
          width={width}
          filmstrip={filmstrip?.kind === 'drawn' ? filmstrip.filmstrip : null}
          ratio={ratio}
        />
      </div>
    </section>
  );
}
