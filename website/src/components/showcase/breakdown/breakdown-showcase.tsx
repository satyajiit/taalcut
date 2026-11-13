// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: reel breakdown showcase, "The reel, slot by slot" · mode: Operate · system: WEB2 Remix Vernacular
 * the saved reel playing beside the coded app window, open on Templates, reading it: rebuilt lean from the app's
 *   breakdown card and review (packages/ui/src/cards/breakdown-card.tsx, templates/review-sheet.tsx,
 *   cut-handles.tsx). The window's bar names the file; its page carries the card's facts as chips, what is left to
 *   check in words, the reel's lanes on one time axis (a marigold playhead following the reel beside it), a line
 *   that reads out the cut you point at or chose (its time, whether it is on a beat, the shots either side), Frame
 *   earlier and Frame later to move the chosen cut without a keyboard (the touch equivalent of ← →, WCAG 2.5.8), and
 *   a legend that puts a word beside every colour
 * states: to check (the dashed warning circle and its words) · every cut checked (the success glyph and its words) ·
 *   a cut pointed at or chosen (its time, on a beat or not, its doubt) · moved (teal: "You moved it") · Frame
 *   earlier, Frame later (secondary buttons: default, hover, focus, active; disabled until a cut is chosen, and at a
 *   neighbour or the reel's end; success: the new time, said politely) · Put the cuts back (secondary button:
 *   default, hover, focus, active, disabled when nothing moved) · the reel's own (reel-side.tsx)
 * motion: the lanes' arrival (breakdown-lanes.tsx), the reel's segment fill and the playhead from its clock;
 *   reduced motion: nothing moves until the visitor plays the reel */

import { AudioLines, CircleDashed, FileVideo, Layers } from 'lucide-react';
import { useMotionValue } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { Key, ShowcasePlate } from '../plate';
import { OnEdge, ReelSide } from '../reel-side';
import { StageGrid } from '../stage';
import { formatLength, formatTime } from '../timecode';
import { useArrival } from '../use-arrival';
import { BreakdownLanes } from './breakdown-lanes';
import { nudgeCut, onBeat } from './cuts';
import { DOUBT_WORDS, sampleBreakdown, type SampleBreakdown } from './sample';

/** The cut state both the page and the features index use. */
export function useBreakdownState(sample: SampleBreakdown) {
  const original = useMemo(() => sample.cuts.map((cut) => cut.at), [sample]);
  const [times, setTimes] = useState<readonly number[]>(original);
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  /** The cut last focused or pressed: Frame earlier and Frame later move it. */
  const [selected, setSelected] = useState<number | null>(null);
  const open = new Set(
    sample.cuts.flatMap((cut, i) => (cut.doubt && !checked.has(i) && times[i] === original[i] ? [i] : [])),
  );
  const move = (index: number, time: number) => {
    setTimes((now) => now.map((t, i) => (i === index ? time : t)));
    setActive(index);
  };
  const reset = (index: number) =>
    setTimes((now) => now.map((t, i) => (i === index ? (original[i] ?? t) : t)));
  const looksRight = (index: number) => setChecked((now) => new Set(now).add(index));
  const nudge = (index: number, direction: -1 | 1) =>
    setTimes((now) => now.map((t, i) => (i === index ? nudgeCut(now, i, direction, sample.duration) : t)));
  const resetAll = () => {
    setTimes(original);
    setChecked(new Set());
  };
  return {
    original,
    times,
    open,
    active,
    setActive,
    selected,
    setSelected,
    move,
    nudge,
    reset,
    looksRight,
    resetAll,
  };
}

interface ReadoutProps {
  readonly id: string;
  readonly sample: SampleBreakdown;
  readonly times: readonly number[];
  readonly original: readonly number[];
  readonly open: ReadonlySet<number>;
  readonly active: number | null;
}

function Readout({ id, sample, times, original, open, active }: ReadoutProps) {
  const time = active === null ? undefined : times[active];
  if (active === null || time === undefined)
    return (
      <p id={id} className="m-0 type-body text-ink-2">
        Choose a cut to see its time and move it a frame.
      </p>
    );
  const moved = time !== original[active];
  const doubt = sample.cuts[active]?.doubt;
  const before = sample.shots[active]?.word;
  const after = sample.shots[active + 1]?.word;
  return (
    <p id={id} className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink">
      <span className="font-medium">Cut {active + 1}</span>
      <span className="tc-mono text-ink">{formatTime(time)}</span>
      <span className="text-ink-2">
        {onBeat(time, sample.beats) ? 'on a music beat' : 'between two beats'}
      </span>
      {before && after ? (
        <span className="text-ink-2">
          {before} to {after}
        </span>
      ) : null}
      {open.has(active) && doubt ? <span className="text-warning-strong">{DOUBT_WORDS[doubt]}</span> : null}
      {moved ? <Chip tone="you">You moved it</Chip> : null}
    </p>
  );
}

interface FrameButtonsProps {
  readonly times: readonly number[];
  readonly duration: number;
  readonly selected: number | null;
  readonly describedBy: string;
  readonly onNudge: (index: number, direction: -1 | 1) => void;
}

/** Moves the chosen cut a frame each way: the same as ← →, for a finger (WCAG 2.5.8's equivalent control). */
function FrameButtons({ times, duration, selected, describedBy, onNudge }: FrameButtonsProps) {
  const [said, setSaid] = useState('');
  const time = selected === null ? undefined : times[selected];
  const can = (direction: -1 | 1) =>
    selected !== null && time !== undefined && nudgeCut(times, selected, direction, duration) !== time;
  const press = (direction: -1 | 1) => {
    if (selected === null || !can(direction)) return;
    onNudge(selected, direction);
    setSaid(`Cut ${selected + 1} at ${formatTime(nudgeCut(times, selected, direction, duration))}`);
  };
  const Earlier = SHOWCASE_ICONS.earlier;
  const Later = SHOWCASE_ICONS.later;
  return (
    <div role="group" aria-label="Move the chosen cut" className="flex gap-2">
      <button
        type="button"
        data-nudge="earlier"
        className={buttonClasses('secondary', 'md')}
        disabled={!can(-1)}
        aria-describedby={describedBy}
        onClick={() => press(-1)}
      >
        <Earlier aria-hidden className="size-4" />
        Frame earlier
      </button>
      <button
        type="button"
        data-nudge="later"
        className={buttonClasses('secondary', 'md')}
        disabled={!can(1)}
        aria-describedby={describedBy}
        onClick={() => press(1)}
      >
        Frame later
        <Later aria-hidden className="size-4" />
      </button>
      <span role="status" className="sr-only">
        {said}
      </span>
    </div>
  );
}

function Legend() {
  return (
    <ul
      aria-label="What the colours mean"
      className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 border-t border-rule-subtle p-0 pt-3 type-meta text-ink-2"
    >
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px rounded-pill bg-beat-strong" />
        Music beat
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-0.5 rounded-pill bg-beat-strong" />
        Cut
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-pill border-2 border-dashed border-warning-strong" />
        Not sure
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-0.5 rounded-pill bg-you-strong" />
        Moved by you
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-0.5 rounded-pill bg-playhead-strong" />
        Playhead
      </li>
    </ul>
  );
}

export function BreakdownShowcase() {
  const sample = useMemo(sampleBreakdown, []);
  const state = useBreakdownState(sample);
  const time = useMotionValue(0);
  const [lanes, phase] = useArrival<HTMLDivElement>(0.5);
  const anyMoved = state.times.some((t, i) => t !== state.original[i]);
  const toCheck = state.open.size;
  const ToCheck = SHOWCASE_ICONS.toCheck;
  const Passed = SHOWCASE_ICONS.passed;
  const Reset = SHOWCASE_ICONS.replay;
  const tempo = Math.round(sample.tempo);
  const readout = useId();

  const reel = (
    <ReelSide
      time={time}
      stickers={
        <>
          <OnEdge at="-right-6 top-[22%]">
            <Sticker field="pink" icon={AudioLines} tilt={-5}>
              {sample.beats.length} music beats
            </Sticker>
          </OnEdge>
          <OnEdge at="-left-6 top-[46%]">
            <Sticker field="violet" icon={Layers} tilt={4} delay={0.1}>
              {sample.shots.length} slots
            </Sticker>
          </OnEdge>
          <OnEdge at="-right-4 top-[68%]">
            <Sticker field="lime" icon={CircleDashed} tilt={-3} delay={0.2}>
              {sample.cuts.filter((c) => c.doubt).length} unsure cut
            </Sticker>
          </OnEdge>
        </>
      }
    />
  );

  return (
    <StageGrid reel={reel}>
      <AppWindow
        title="Read a reel"
        area="templates"
        size="lg"
        fit="fluid"
        actions={
          <span className="hidden items-center gap-1.5 type-meta text-ink-2 @min-[34rem]:flex">
            <FileVideo aria-hidden className="size-3.5 text-ink-3" />
            vietnam-reel.mp4
          </span>
        }
      >
        <ShowcasePlate slug="reel-breakdown" label="A saved reel’s breakdown" className="flex flex-col gap-5">
          <header className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="m-0 type-page-title text-ink">The reel, slot by slot</h3>
                <span className="type-meta text-ink-2">{sample.title}</span>
              </div>
              <p className="m-0 type-meta text-ink-2">
                Its music beats come from its audio. Its shots, cuts and words on screen are the reel’s own.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone="ai">
                <SHOWCASE_ICONS.slots aria-hidden />
                {sample.shots.length} slots
              </Chip>
              <Chip>
                <SHOWCASE_ICONS.length aria-hidden />
                {formatLength(sample.duration)}
              </Chip>
              <Chip tone="beat">
                <SHOWCASE_ICONS.beat aria-hidden />
                {tempo} music beats a minute
              </Chip>
              <Chip tone="you">
                <SHOWCASE_ICONS.music aria-hidden />
                Music kept on your computer
              </Chip>
            </div>
            {toCheck > 0 ? (
              <p
                data-slot="to-check"
                className="m-0 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 type-body text-ink"
              >
                <ToCheck aria-hidden className="mt-1 size-4 shrink-0 text-warning-strong" />
                <span>
                  {toCheck} to check: a cut Taalcut isn’t sure of. Move it, or focus it and press{' '}
                  <Key>Return</Key> if it looks right.
                </span>
              </p>
            ) : (
              <p
                data-slot="to-check"
                role="status"
                className="m-0 flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2 type-body text-ink"
              >
                <Passed aria-hidden className="mt-1 size-4 shrink-0 text-success-strong" />
                <span>Every cut checked. The template keeps your fix.</span>
              </p>
            )}
          </header>
          <div ref={lanes} data-arrival={phase}>
            <BreakdownLanes
              sample={sample}
              times={state.times}
              original={state.original}
              open={state.open}
              active={state.active}
              onActive={state.setActive}
              selected={state.selected}
              onSelect={state.setSelected}
              onMove={state.move}
              onReset={state.reset}
              onLooksRight={state.looksRight}
              play={phase === 'play'}
              time={time}
            />
          </div>
          <div className="flex min-h-12 flex-col gap-3 border-t border-rule-subtle pt-4 @min-[52rem]:flex-row @min-[52rem]:items-center @min-[52rem]:justify-between">
            <Readout
              id={readout}
              sample={sample}
              times={state.times}
              original={state.original}
              open={state.open}
              active={state.active ?? state.selected}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
              <FrameButtons
                times={state.times}
                duration={sample.duration}
                selected={state.selected}
                describedBy={readout}
                onNudge={state.nudge}
              />
              <button
                type="button"
                className={buttonClasses('quiet', 'md')}
                disabled={!anyMoved && toCheck > 0}
                onClick={state.resetAll}
              >
                <Reset aria-hidden className="size-4" />
                Put the cuts back
              </button>
            </div>
          </div>
          <Legend />
        </ShowcasePlate>
      </AppWindow>
    </StageGrid>
  );
}
