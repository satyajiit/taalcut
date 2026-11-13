// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: templates fragment, for the features index · mode: Operate · system: WEB2 Remix Vernacular
 * the showcase in small, working, in its own coded app window open on Templates: the saved reel (from a window wide
 *   enough), the template (its slots as tall as their time, numbered), your version playing beside it on the saved
 *   reel's clock, and the camera rolls as highlights to fill it from
 * states: the showcase's own (use-fill, template-frame, version-frame, roll-chips), compact
 * motion: the flights when a roll is chosen, and when it is scrolled to; reduced motion: it fills at once */

import { useMotionValue } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';
import { FlightLayer } from '#components/demo/flight-layer';
import { AppWindow } from '#components/ui/app-window';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import { ShowcasePlate } from '../plate';
import { useArrival } from '../use-arrival';
import { RollChips } from './roll-chips';
import { fillWords, pickWords, ROLLS, templateReel, templateSegments, templateSlots } from './template';
import { TemplateFrame } from './template-frame';
import { useTemplateFill } from './use-fill';
import { VersionFrame } from './version-frame';

const name = (clipId: string) => pickWords({ clipId, sure: 'high' }).name;
const seconds = (clipId: string) => pickWords({ clipId, sure: 'high' }).seconds;

export function TemplatesFragment() {
  const reel = templateReel();
  const slots = useMemo(() => templateSlots(reel), [reel]);
  const [arrival, phase] = useArrival<HTMLDivElement>(0.3, 0.8);
  const fill = useTemplateFill(slots, reel.tempo, phase);
  const reelTime = useMotionValue(0);
  const clock = useMotionValue(0);
  const [reelPlaying, setReelPlaying] = useState(false);
  const [playing, setPlaying] = useState(false);
  const onPlaying = useCallback((p: boolean) => setPlaying(p), []);
  const { roll, landed } = fill;
  const full = roll.picks.length > 0 && landed >= slots.length;
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      fill.refs.stage.current = el;
      arrival.current = el;
    },
    [fill.refs.stage, arrival],
  );
  return (
    <AppWindow title="Templates" area="templates" size="md" fit="fluid">
      <ShowcasePlate slug="templates-fragment" label="A template, filled from a camera roll">
        <div ref={stageRef} data-arrival={phase} className="@container relative">
          <div className="grid grid-cols-2 items-start gap-4 @min-[34rem]:grid-cols-[9.5rem_9.5rem_minmax(0,1fr)] @min-[34rem]:gap-6 @min-[50rem]:grid-cols-[9.5rem_9.5rem_9.5rem_minmax(0,1fr)]">
            <div className="hidden @min-[50rem]:block">
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
            </div>
            <TemplateFrame
              compact
              slots={slots}
              beats={reel.beats}
              roll={roll}
              landed={landed}
              clock={clock}
              playing={playing}
              bursts={fill.bursts}
              bandRef={fill.refs.band}
              reduce={fill.reduce}
              words={name}
            />
            <VersionFrame
              compact
              reel={reel}
              slots={slots}
              roll={roll}
              landed={landed}
              clock={clock}
              follow={reelTime}
              following={reelPlaying}
              reduce={fill.reduce}
              onPlaying={onPlaying}
              seconds={seconds}
            />
            <div className="col-span-2 flex flex-col gap-3 @min-[34rem]:col-span-1 @min-[34rem]:self-center">
              <h3 className="m-0 type-section text-ink">That Airport Feeling</h3>
              <p className="m-0 type-meta text-ink-2 tabular-nums">
                {slots.length} slots on {reel.beats.length} music beats. Fill it from
              </p>
              <RollChips
                size="sm"
                rolls={ROLLS}
                value={roll.id}
                onChoose={fill.fill}
                coverRef={fill.refs.cover}
              />
              <p role="status" className="m-0 min-h-[2lh] type-meta text-ink-2">
                {full || roll.picks.length === 0 ? fillWords(roll, slots.length) : ''}
              </p>
            </div>
          </div>
          <FlightLayer ghosts={fill.ghosts} onLanded={fill.onLanded} />
        </div>
      </ShowcasePlate>
    </AppWindow>
  );
}
