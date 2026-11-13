// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: templates showcase, "a template is a reel with the footage taken out" · mode: Persuade (footage first) ·
 *   system: WEB2 Remix Vernacular (rose is the beats and the page's job; violet the AI's slots and picks; teal the
 *   roll that is yours; no marigold here: the page's one is the waitlist's)
 * three 9:16 frames, read left to right: the saved reel playing under its slot strip; the same frame with its footage
 *   taken out, its slots stacked as tall as their time, each saying the kind of shot it wants; and your version, the
 *   template filled from a camera roll and playing, cut on the reel's own slots. Between the template and your version,
 *   the camera rolls as Stories highlights: choosing one flies its clips into the slots, one a half beat, and your
 *   version re-cuts. While the saved reel plays, your version keeps its clock, and the template lights the slot both
 *   are in. Under them, the starters: a shelf of 9:16 templates for a day with no reel to copy
 * states: the arrival (below the fold: the template waits empty, then the Vietnam trip's clips fly in, about 3 s; on
 *   screen at load, in the server HTML and under reduced motion: filled, at rest) · a roll chosen (flying, landed) · the
 *   empty roll (the template and your version wait) · the frames' own (reel-frame, template-frame, version-frame) ·
 *   wide (the three frames in a row, the highlights between the last two) · medium (three in a row, the highlights
 *   under) · narrow (a sideways row of frames that brings the one at work into view, the highlights under)
 * motion: the flights (transform only) and the frames' own; reduced motion: every slot fills at once, nothing flies,
 *   nothing plays until the visitor presses Play */

import { ArrowRight } from 'lucide-react';
import { useMotionValue } from 'motion/react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { FlightLayer } from '#components/demo/flight-layer';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { formatLength } from '../timecode';
import { useArrival } from '../use-arrival';
import { RollChips } from './roll-chips';
import { StarterShelf } from './starter-shelf';
import { fillWords, pickWords, ROLLS, templateReel, templateSegments, templateSlots } from './template';
import { TemplateFrame } from './template-frame';
import { useTemplateFill } from './use-fill';
import { VersionFrame } from './version-frame';

const name = (clipId: string) => pickWords({ clipId, sure: 'high' }).name;
const seconds = (clipId: string) => pickWords({ clipId, sure: 'high' }).seconds;

function Column({
  icon: Icon,
  label,
  meta,
  frameRef,
  className,
  children,
}: {
  readonly icon: typeof ICONS.clip;
  readonly label: string;
  readonly meta: string;
  readonly frameRef: (el: HTMLElement | null) => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <figure
      ref={frameRef}
      className={cn(
        'm-0 flex w-[min(16rem,74%)] shrink-0 snap-center flex-col gap-3 @min-[44rem]:w-auto',
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 type-label font-semibold text-ink">
          <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4 self-center text-ink-2" />
          {label}
        </span>
        <span className="type-meta text-ink-2">{meta}</span>
      </figcaption>
      {children}
    </figure>
  );
}

export function TemplatesShowcase() {
  const reel = templateReel();
  const slots = useMemo(() => templateSlots(reel), [reel]);
  const [arrival, phase] = useArrival<HTMLDivElement>(0.3, 0.8);
  const fill = useTemplateFill(slots, reel.tempo, phase);
  const reelTime = useMotionValue(0);
  const clock = useMotionValue(0);
  const [reelPlaying, setReelPlaying] = useState(false);
  const [versionPlaying, setVersionPlaying] = useState(false);
  const onVersion = useCallback((playing: boolean) => setVersionPlaying(playing), []);
  const { roll, landed } = fill;
  const full = roll.picks.length > 0 && landed >= slots.length;
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      fill.refs.stage.current = el;
      arrival.current = el;
    },
    [fill.refs.stage, arrival],
  );
  const title = reel.title.split(',')[0] ?? reel.title;

  return (
    <div
      role="group"
      aria-label="A demonstration of the Taalcut app: a saved reel, its template, and the template filled from your clips"
      className="flex flex-col gap-16"
    >
      <div
        ref={stageRef}
        role="region"
        aria-label="A saved reel, its template, and your version"
        data-showcase="templates"
        data-arrival={phase}
        className="@container relative"
      >
        <div className="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-[minmax(0,18rem)_2.5rem_minmax(0,18rem)_auto_minmax(0,18rem)] @min-[60rem]:items-center @min-[60rem]:justify-center @min-[60rem]:gap-x-7">
          <div
            ref={fill.refs.row}
            className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pt-1 pb-6 @min-[44rem]:mx-0 @min-[44rem]:grid @min-[44rem]:grid-cols-3 @min-[44rem]:gap-6 @min-[44rem]:overflow-visible @min-[44rem]:px-0 @min-[44rem]:pb-0 @min-[60rem]:contents"
          >
            <Column
              icon={ICONS.reel}
              label="Saved reel"
              meta={`${title}, ${formatLength(reel.durationSec)}`}
              frameRef={fill.refs.frame(0)}
              className="@min-[60rem]:col-start-1 @min-[60rem]:row-start-1"
            >
              <ReelFrame
                sources={reel.reference}
                poster={reel.poster}
                label={`A saved reel: ${reel.title}`}
                time={reelTime}
                onPlayingChange={setReelPlaying}
                bar={
                  <SegmentBar
                    segments={templateSegments(slots)}
                    beats={reel.beats}
                    time={reelTime}
                    state="playing"
                    layout="time"
                  />
                }
              />
            </Column>
            <span
              aria-hidden
              className="hidden text-ink-3 @min-[60rem]:col-start-2 @min-[60rem]:row-start-1 @min-[60rem]:mt-8 @min-[60rem]:flex @min-[60rem]:justify-center"
            >
              <ArrowRight strokeWidth={ICON_STROKE} className="size-6" />
            </span>
            <Column
              icon={ICONS.template}
              label="The template"
              meta={`${slots.length} slots on ${reel.beats.length} music beats`}
              frameRef={fill.refs.frame(1)}
              className="@min-[60rem]:col-start-3 @min-[60rem]:row-start-1"
            >
              <TemplateFrame
                slots={slots}
                beats={reel.beats}
                roll={roll}
                landed={landed}
                clock={clock}
                playing={versionPlaying}
                bursts={fill.bursts}
                bandRef={fill.refs.band}
                reduce={fill.reduce}
                words={name}
              />
            </Column>
            <Column
              icon={ICONS.clip}
              label="Your version"
              meta={
                roll.picks.length === 0
                  ? 'Waiting'
                  : roll.own
                    ? `From ${roll.label}, as the reel`
                    : `From ${roll.label}`
              }
              frameRef={fill.refs.frame(2)}
              className="@min-[60rem]:col-start-5 @min-[60rem]:row-start-1"
            >
              <VersionFrame
                reel={reel}
                slots={slots}
                roll={roll}
                landed={landed}
                clock={clock}
                follow={reelTime}
                following={reelPlaying}
                reduce={fill.reduce}
                onPlaying={onVersion}
                seconds={seconds}
              />
            </Column>
          </div>
          <div className="flex flex-col items-center gap-3 text-center @min-[60rem]:col-start-4 @min-[60rem]:row-start-1 @min-[60rem]:mt-8 @min-[60rem]:w-28">
            <span className="type-label-sm text-ink-2">Fill it from</span>
            <RollChips
              rolls={ROLLS}
              value={roll.id}
              onChoose={fill.fill}
              coverRef={fill.refs.cover}
              className="justify-center @min-[60rem]:flex-col @min-[60rem]:items-center"
            />
            <p role="status" className="m-0 min-h-[2lh] max-w-[22rem] type-meta text-balance text-ink-2">
              {full || roll.picks.length === 0 ? fillWords(roll, slots.length) : ''}
            </p>
          </div>
        </div>
        <FlightLayer ghosts={fill.ghosts} onLanded={fill.onLanded} />
      </div>
      <div role="region" aria-label="The starter templates" data-showcase="templates-starters">
        <StarterShelf />
      </div>
    </div>
  );
}
