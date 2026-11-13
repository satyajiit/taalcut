// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the map's crossing cards · mode: Persuade · system: WEB2 Remix Vernacular
 * states: landed (outside your computer, or with the AI you chose) · at home (with the AI on your computer under On
 *   this Mac) · held (Local only: back at the wall, captioned with what stays) · moving between places by shared
 *   layout · arriving (in the stage's run: each comes through the gate, in turn) · reduced motion (they jump; no
 *   travel). Not controls: each card's drawing is hidden from assistive technology; its caption says the fact.
 * What may leave your computer, as real things: the agent's message and a tool result (the agent page's own words),
 * a frame of the owner's footage with the AI's mark on it, a pasted reel as a link chip, speech as a wave card that
 * names ElevenLabs, crash reports and usage counts as a dashed card, and the update check as a small chip. Each card
 * is captioned with its fact's label and value from LOCAL_ONLY, word for word. */

import { Bug, Check, Link2, Mic, RefreshCw } from 'lucide-react';
import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { spriteStyle } from '#components/showcase/frames';
import { STEPS, USER_WORDS } from '#components/showcase/agent/run-script';
import { AI_MAP, AI_MAP_OBJECTS } from '#content/ai-map';
import { CAMERA_ROLL } from '#content/reels';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { type Lane, type LaneId, type Place, splitRule } from './model';

/** The frame a cloud model looks at: one of the owner's clips (the coffees from "Vietnam, on repeat"), from the atlas. */
const LOOKED_AT = CAMERA_ROLL.clips.find((c) => c.id === 'repeat-04')?.sprite ?? CAMERA_ROLL.clips[0]?.sprite ?? 0;
const READ = STEPS[0]!;

const FACE = 'bg-raised shadow-sticker ring-1 ring-rule-subtle';

/** The agent's message and a tool result: the chat as the agent page has it (the message alone on a phone). */
function Message() {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-2 rounded-2xl p-2.5 sm:w-[15rem] sm:flex-none xl:w-[17.5rem]', FACE)}>
      <p className="m-0 ms-auto max-w-[94%] rounded-2xl rounded-br-md bg-bubble px-3 py-2 type-label-sm text-ink">{USER_WORDS}</p>
      <p className="m-0 flex items-start gap-2 rounded-xl bg-violet-soft px-2.5 py-2 type-label-sm text-ink-2 max-sm:hidden">
        <AiMark className="mt-0.5 size-3.5 shrink-0 text-violet-strong" />
        <span className="min-w-0">
          <span className="font-semibold text-ink">{READ.text}</span> {READ.found}
        </span>
        <Check strokeWidth={2.5} className="mt-0.5 size-3.5 shrink-0 text-violet-strong" />
      </p>
    </div>
  );
}

/** A video frame a cloud model looks at: the owner's footage at 9:16, the AI's mark on its corner. */
function Frame() {
  return (
    <span className="relative block w-14 shrink-0 sm:w-16">
      <span className="block aspect-[9/16] w-full rounded-xl shadow-sticker ring-2 ring-sticker-cut" style={spriteStyle(LOOKED_AT)} />
      <span className="absolute -top-2.5 -right-2.5 inline-grid size-8 place-items-center rounded-pill bg-violet text-violet-ink shadow-lift">
        <AiMark className="size-4.5" />
      </span>
    </span>
  );
}

const WAVE = [5, 11, 17, 9, 14, 7, 12, 18, 8, 13, 6, 10] as const;

function Pill({ children, dashed = false, small = false }: { readonly children: ReactNode; readonly dashed?: boolean; readonly small?: boolean }) {
  return (
    <span
      className={cn(
        // Two to a row: the words may wrap in a narrow column, so on a phone the shape is a rounded card, not a pill.
        'inline-flex w-max max-w-full items-center gap-2 rounded-2xl px-3 py-2 font-semibold text-ink sm:rounded-pill',
        small ? 'min-h-9 type-label-sm' : 'min-h-10 type-label-sm sm:px-3.5 sm:type-label',
        dashed ? 'border-[1.5px] border-dashed border-ink-3 bg-raised text-ink-2' : FACE,
      )}
    >
      {children}
    </span>
  );
}

/** The drawing for a lane's card. */
export function CardDrawing({ id }: { readonly id: LaneId }) {
  const Reel = ICONS.reel;
  switch (id) {
    case 'cloud':
      return (
        <span className="flex w-full items-start gap-3 pt-2.5 pe-2.5 sm:w-auto">
          <Message />
          <Frame />
        </span>
      );
    case 'links':
      return (
        <Pill>
          <Reel strokeWidth={ICON_STROKE} className="size-4.5 shrink-0" />
          {AI_MAP_OBJECTS.link}
          <Link2 strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-3 max-sm:hidden" />
        </Pill>
      );
    case 'speech':
      return (
        <Pill>
          <Mic strokeWidth={ICON_STROKE} className="size-4 shrink-0" />
          {AI_MAP_OBJECTS.speech}
          <span className="flex items-center gap-[2px]">
            {WAVE.map((h, i) => (
              <span key={i} className={cn('w-[2px] rounded-pill bg-ink-2', i >= 6 && 'max-sm:hidden')} style={{ height: `${h}px` }} />
            ))}
          </span>
        </Pill>
      );
    case 'reports':
      return (
        <Pill dashed>
          <Bug strokeWidth={ICON_STROKE} className="size-4 shrink-0" />
          {AI_MAP_OBJECTS.reports}
        </Pill>
      );
    default:
      return (
        <Pill small>
          <RefreshCw strokeWidth={ICON_STROKE} className="size-3.5 shrink-0 text-ink-2" />
          {AI_MAP_OBJECTS.updates}
        </Pill>
      );
  }
}

/** A lane's caption: its label, then its words; the cloud lane's rule on a line of its own. */
function Caption({ lane }: { readonly lane: Lane }) {
  const [lead, rule] = lane.id === 'cloud' && lane.value ? splitRule(lane.value) : [lane.value, ''];
  return (
    <figcaption className="flex max-w-[34rem] flex-col gap-1 type-label-sm text-pretty text-ink-2 sm:type-label">
      <span>
        <span className="font-semibold text-ink">{lane.label}.</span>
        <span className="sr-only"> {lane.crosses ? AI_MAP.leaves : AI_MAP.stays}.</span>
        {lead ? ` ${lead}` : null}
      </span>
      {rule ? (
        <span data-slot="map-rule" className="font-semibold text-ink">
          {rule}
        </span>
      ) : null}
    </figcaption>
  );
}

/**
 * How a card is captioned: in full under it (where it lands), or, resting home, by its name for assistive technology
 * only, since the map says the held facts once under the pile (`none` for those).
 */
export type CaptionMode = 'full' | 'name' | 'none';

/** A card and its caption, flying between places by shared layout; `enter` is its arrival through the gate. */
export function MapCard({ lane, place, enter, caption = 'full', className }: {
  readonly lane: Lane;
  readonly place: Place;
  readonly enter?: Variants;
  readonly caption?: CaptionMode;
  readonly className?: string;
}) {
  return (
    <motion.figure
      layoutId={`map-card-${lane.id}`}
      layout
      variants={enter}
      transition={{ type: 'spring', stiffness: 240, damping: 30, mass: 0.9 }}
      data-slot="map-lane"
      data-lane={lane.id}
      data-place={place}
      data-crosses={lane.crosses ? 'true' : 'false'}
      className={cn('m-0 flex min-w-0 flex-col gap-2', className)}
    >
      <span aria-hidden className="flex">
        <CardDrawing id={lane.id} />
      </span>
      {caption === 'full' ? <Caption lane={lane} /> : null}
      {caption === 'name' ? (
        <figcaption className="sr-only">
          {lane.label}. {lane.crosses ? AI_MAP.leaves : AI_MAP.stays}.
        </figcaption>
      ) : null}
    </motion.figure>
  );
}

/** Where a card would land, while it is held at home: its outline, its name, and that it stays. */
export function EmptySlot({ lane }: { readonly lane: Lane }) {
  return (
    <div aria-hidden data-slot="map-slot" data-lane={lane.id} className="flex flex-col gap-2">
      <span className="flex min-h-10 w-max max-w-full items-center rounded-2xl border-[1.5px] border-dashed border-rule-strong px-3.5 py-2 type-label-sm font-semibold text-ink-2 sm:rounded-pill sm:type-label">
        {lane.label}
      </span>
      <span className="type-label-sm text-ink-2 sm:type-label">{AI_MAP.stays}</span>
    </div>
  );
}
