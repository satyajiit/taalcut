// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the map's zones · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the AI with the cloud model (its mark and the profile's name big on violet, its line under it) · the AI on
 *   your computer (On this Mac: the mark flies home by shared layout and says its line; the cloud lane's card rests on
 *   your footage; the AI's place outside greys, dashed, and says no cloud model runs) · closed (Local only: the AI's
 *   place greys and says what Local only keeps; the cards come home and pile against the wall, the facts that stay
 *   under them) · reduced motion (the mark and cards jump; words cross-fade in 150 ms) · without JavaScript (Everyday
 *   with the cloud model). Not controls.
 * Your computer, on teal (yours): the owner's footage as a wall of real 9:16 frames, Taalcut's own models doing the
 * always-local jobs with Kaatu at a laptop, and whatever stays home. Outside your computer: the AI you chose, on
 * violet, then plain ground for what leaves without going to the AI. */

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { Kaatu } from '#components/kaatu/kaatu';
import { spriteStyle } from '#components/showcase/frames';
import { IconText } from '#components/ui/icon-text';
import { AI_MAP } from '#content/ai-map';
import { LOCAL_ONLY } from '#content/providers';
import { CAMERA_ROLL } from '#content/reels';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { FadeLayer } from './gate';
import { type CloudSide, type Lane, LOCAL_PROFILE, profileLimit, profileLine } from './model';

/**
 * Your footage: twelve of the owner's clips from all three trips, day views, city nights and the flight in turn, as the
 * roll's atlas holds them: a row of five on a phone, four by three where the zone is narrow (1024 to 1279 px), five by
 * two from 1280 px. None is a story's backdrop or the frame a cloud model looks at, on the same page.
 */
const FOOTAGE_IDS = ['repeat-03', 'vietnam-10', 'airport-02', 'repeat-01', 'vietnam-05', 'vietnam-08', 'airport-08', 'vietnam-11', 'repeat-07', 'vietnam-02', 'airport-04', 'repeat-12'];
const FOOTAGE = FOOTAGE_IDS.flatMap((id) => CAMERA_ROLL.clips.find((c) => c.id === id) ?? []);
const JOB_ICONS = [ICONS.search, ICONS.caption, ICONS.beat] as const;
const [FOOTAGE_LABEL, FOOTAGE_WORDS] = LOCAL_ONLY.staysWhenOn[0]!;
/** The cloud lane's name in the app's list ("Cloud models you chose"), on its empty place. */
const CLOUD_LABEL = LOCAL_ONLY.leavesWhenOff[0]![0];

/** The AI's mark, flying between zones by shared layout. */
function Mark({ greyed, reduce, className }: { readonly greyed: boolean; readonly reduce: boolean; readonly className?: string }) {
  return (
    <motion.span
      layoutId="map-ai-mark"
      data-slot="map-ai-mark"
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 30, mass: 0.9 }}
      className={cn('inline-grid shrink-0 place-items-center rounded-pill', greyed ? 'bg-rule text-ink-2' : 'bg-violet text-violet-ink shadow-lift', className)}
    >
      <AiMark className="size-[58%]" />
    </motion.span>
  );
}

/** Words that change with the state, cross-faded. */
function Swap({ words, slot, className, reduce }: { readonly words: string; readonly slot?: string; readonly className: string; readonly reduce: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p
        key={words}
        data-slot={slot}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: reduce ? REDUCED_FADE : DUR.micro } }}
        transition={{ duration: reduce ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
        className={cn('m-0 min-w-0 text-pretty', className)}
      >
        {words}
      </motion.p>
    </AnimatePresence>
  );
}

/** A held lane's fact, said once under the pile. */
function HeldFact({ lane }: { readonly lane: Lane }) {
  return (
    <li className="type-label text-pretty text-ink-2">
      <span className="font-semibold text-ink">{lane.label}.</span> {lane.value}
    </li>
  );
}

export function ComputerZone({ aiHere, home, held, reduce }: {
  readonly aiHere: boolean;
  /** The cards resting on your computer: the cloud lane's under On this Mac, all but the update check's under Local only. */
  readonly home: readonly ReactNode[];
  /** The held lanes whose words say what stays (Local only). */
  readonly held: readonly Lane[];
  readonly reduce: boolean;
}) {
  const line = profileLine(LOCAL_PROFILE);
  const limit = profileLimit();
  const piled = home.length > 0;
  return (
    <div data-slot="map-computer" className="relative flex min-w-0 flex-col gap-4 bg-teal-soft p-4 sm:gap-5 sm:p-6 lg:p-7">
      <IconText icon={ICONS.thisComputer} tone="you" size="lg" as="p" className="m-0 type-site-subhead text-ink">
        {AI_MAP.computer}
      </IconText>
      <div className="flex flex-col gap-2.5">
        {/* The footage wall; what rests home piles against the wall on top of it from 1024 px, like stickers. */}
        <div className="relative">
          <div aria-hidden className="grid grid-cols-5 gap-1.5 lg:grid-cols-4 xl:grid-cols-5">
            {FOOTAGE.map((c, i) => (
              <span
                key={c.id}
                className={cn('aspect-[9/16] rounded-lg shadow-sticker ring-2 ring-sticker-cut', i >= 5 && 'max-lg:hidden', i >= 10 && 'xl:hidden')}
                style={spriteStyle(c.sprite)}
              />
            ))}
          </div>
          {piled ? (
            <div data-slot="map-pile" className="flex flex-wrap items-start gap-3 max-lg:mt-4 lg:absolute lg:inset-y-0 lg:-right-3 lg:flex-col lg:flex-nowrap lg:items-end lg:justify-center lg:gap-0">
              {home}
            </div>
          ) : null}
        </div>
        <p className="m-0 type-label text-ink-2">
          <span className="font-semibold text-ink">{FOOTAGE_LABEL}.</span> {FOOTAGE_WORDS}
        </p>
        {held.length > 0 ? (
          <ul data-slot="map-held" className="m-0 flex list-none flex-col gap-1 p-0">
            {held.map((l) => (
              <HeldFact key={l.id} lane={l} />
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="type-label font-semibold text-ink">{AI_MAP.models}</span>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0 sm:gap-1.5 lg:flex-col lg:items-start">
            {AI_MAP.jobs.map((job, i) => {
              const Icon = JOB_ICONS[i]!;
              return (
                <li key={job} className="inline-flex h-8 items-center gap-1 rounded-pill bg-raised px-2.5 type-label-sm font-semibold whitespace-nowrap text-ink ring-1 ring-rule-subtle lg:h-9 lg:gap-1.5 lg:px-3 lg:type-label">
                  <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-3.5 text-teal-strong" />
                  {job}
                </li>
              );
            })}
          </ul>
        </div>
        <Kaatu pose="laptop" size={112} follow sticker className="shrink-0 rotate-3 max-lg:absolute max-lg:top-2 max-lg:right-3 max-lg:[--kaatu-size:3.5rem]" />
      </div>
      {/* On this Mac: the AI runs here and says its line, its limit in full weight. */}
      {aiHere ? (
        <div data-slot="map-local-ai" className="flex items-start gap-3 rounded-2xl bg-raised/70 p-3.5 ring-1 ring-rule-subtle">
          <Mark greyed={false} reduce={reduce} className="size-11" />
          <p className="m-0 flex min-w-0 flex-col type-label text-pretty text-ink-2">
            <span className="type-site-body font-semibold text-ink">{LOCAL_PROFILE}</span>
            <span>
              {line.slice(0, line.length - limit.length)}
              <span className="font-semibold text-ink">{limit}</span>
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function OutsideZone({ side, aiHere, ai, outside, control, reduce }: {
  readonly side: CloudSide;
  readonly aiHere: boolean;
  /** The cloud lane's card, when it crosses. */
  readonly ai: ReactNode;
  /** What crosses onto plain ground, and the empty places of what is held. */
  readonly outside: ReactNode;
  readonly control: ReactNode;
  readonly reduce: boolean;
}) {
  const greyed = side.kind !== 'model';
  return (
    <div data-slot="map-outside" className="relative flex min-w-0 flex-col gap-4 bg-sunken p-4 sm:p-6 lg:p-7">
      <p className="m-0 pe-12 type-site-subhead text-ink">{AI_MAP.outside}</p>
      {control}
      {/* The AI you chose: violet with its model; greyed and dashed, its words big, while no cloud model runs. It
          grows to its column's height, so the zone has no dead ground below it. */}
      <div
        data-slot="map-cloud"
        data-cloud={side.kind}
        className={cn('relative isolate flex flex-1 flex-col gap-3.5 rounded-2xl bg-violet-soft p-4 sm:p-5', greyed && 'justify-center')}
      >
        <FadeLayer show={greyed} reduce={reduce} className="absolute inset-0 -z-10 rounded-2xl border-2 border-dashed border-rule-strong bg-sunken" />
        <div className={cn('flex min-w-0 gap-3.5', greyed ? 'flex-col items-start' : 'items-center')}>
          {aiHere ? null : <Mark greyed={greyed} reduce={reduce} className="size-12 sm:size-14" />}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="type-label font-semibold text-ink-2">{AI_MAP.cloud}</span>
            {side.kind === 'model' ? (
              <Swap words={side.name} slot="map-cloud-words" reduce={reduce} className="type-site-headline text-ink" />
            ) : (
              <Swap words={side.words} slot="map-cloud-words" reduce={reduce} className="max-w-[30rem] type-site-subhead text-ink" />
            )}
          </div>
        </div>
        {side.kind === 'model' ? (
          <p data-slot="map-profile-line" className="m-0 -mt-1 type-label text-pretty text-ink-2">
            {profileLine(side.name)}
          </p>
        ) : null}
        {ai}
        {/* While no cloud model runs, where its card would land: an outline with the lane's name, from 1024 px. */}
        {greyed ? (
          <span aria-hidden data-slot="map-slot" data-lane="cloud" className="flex h-32 items-center justify-center rounded-2xl border-[1.5px] border-dashed border-rule-strong px-4 type-label font-semibold text-ink-2 max-lg:hidden">
            {CLOUD_LABEL}
          </span>
        ) : null}
      </div>
      <div data-slot="map-plain" className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-6">
        {outside}
      </div>
    </div>
  );
}
