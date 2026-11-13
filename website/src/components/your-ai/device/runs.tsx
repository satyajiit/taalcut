// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: what your computer runs · mode: Persuade · system: WEB2 Remix Vernacular
 * states: lit (the finished state: the server HTML, reduced motion, at rest: every job chip teal, the model in place)
 *   · lighting (in a run: the jobs light up teal one after another as the meter fills, then the model's name rises
 *   in; every pick replays it) · reduced motion (the finished state at once). Not a control.
 * The peak: the model the agent runs on the computer you picked, in display type with how it runs beside it, and the
 * facts that say so, word for word, each by its brand icon. Beside it, what runs here at every size: search, text in
 * video and music beats, and speech, as job chips lit in teal (yours), with their facts. On an 8 GB Mac, understanding
 * images is the AI's, in the cloud: a dashed violet chip. */

import { Cloud, type LucideIcon, Mic } from 'lucide-react';
import { motion } from 'motion/react';
import { AiMark } from '#components/brand/ai-mark';
import { rise } from '#components/home/tour-motion';
import { IconText } from '#components/ui/icon-text';
import { AI_MAP, AI_METER } from '#content/ai-map';
import type { Fact } from '#content/schema';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { EASE_OUT } from '#lib/motion';
import { AGENT_LABEL, ALWAYS, type DeviceRun, SPEECH, UBUNTU_LABEL } from './model';

const JOBS: readonly { readonly name: string; readonly icon: LucideIcon }[] = [
  { name: AI_MAP.jobs[0], icon: ICONS.search },
  { name: AI_MAP.jobs[1], icon: ICONS.caption },
  { name: AI_MAP.jobs[2], icon: ICONS.beat },
  { name: AI_METER.speech, icon: Mic },
];

/** Seconds between two jobs lighting in a run. */
const LIGHT_STEP = 0.08;

/** A job chip: neutral at a run's start, lit teal once the meter reaches it (the finished state is lit). */
function Job({ name, icon: Icon, at }: { readonly name: string; readonly icon: LucideIcon; readonly at: number }) {
  return (
    <li className="relative isolate inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-pill bg-raised px-3.5 type-label font-semibold whitespace-nowrap text-ink-2 ring-1 ring-rule">
      <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
      {name}
      <motion.span
        aria-hidden
        data-slot="job-lit"
        variants={{ hidden: { opacity: 0, transition: { duration: 0 } }, shown: { opacity: 1, transition: { duration: 0.25, ease: EASE_OUT, delay: at } } }}
        className="absolute inset-0 inline-flex items-center gap-1.5 bg-teal px-3.5 text-teal-ink"
      >
        <Icon strokeWidth={ICON_STROKE} className="size-4" />
        {name}
      </motion.span>
    </li>
  );
}

/** A fact in its own words: its label, then what it says, by the brand icon of the computer it names. */
function FactLine({ fact, brand }: { readonly fact: Fact; readonly brand?: 'apple' | 'ubuntu' }) {
  const words = (
    <>
      <span className="font-semibold text-ink">{fact[0]}.</span> {fact[1]}
    </>
  );
  return brand ? (
    <IconText brand={brand} size="lg" as="p" className="m-0 max-w-[36em] type-site-body text-pretty text-ink-2">
      {words}
    </IconText>
  ) : (
    <p className="m-0 max-w-[36em] type-site-body text-pretty text-ink-2">{words}</p>
  );
}

/** The model the agent runs here, in display type, and the facts that say so. */
export function AgentRun({ run, at }: { readonly run: DeviceRun; readonly at: number }) {
  return (
    <div data-slot="device-agent" data-device={run.id} className="flex min-w-0 flex-col gap-4">
      <motion.span variants={rise(at - 0.1)} className="inline-flex w-max items-center gap-1.5 rounded-pill bg-violet-soft px-3 py-1 type-label font-semibold text-violet-strong">
        <AiMark className="size-4" />
        {AGENT_LABEL}
      </motion.span>
      {/* Keyed by the computer: every pick replays the run, so the new model rises in on its own. */}
      <div key={run.id} className="flex min-w-0 flex-col gap-5">
        <motion.p variants={rise(at)} data-slot="device-model" className="m-0 type-site-display text-balance text-ink">
          {run.model}
          {run.runtime ? <span className="block type-site-headline font-bold text-ink-3">{run.runtime}</span> : null}
        </motion.p>
        <motion.div variants={rise(at + 0.12)} className="flex flex-col gap-3">
          {run.agent.map((f) => (
            // The 4B's fact names every computer with 16 GB, so it stands without an icon; the others name theirs.
            <FactLine key={f[0]} fact={f} brand={f[0] === UBUNTU_LABEL ? 'ubuntu' : f[0] === AGENT_LABEL ? undefined : run.brand} />
          ))}
        </motion.div>
        {run.imagesInCloud ? (
          <motion.span
            variants={rise(at + 0.2)}
            data-slot="device-images"
            className="inline-flex w-max items-center gap-1.5 rounded-pill border-[1.5px] border-dashed border-violet-strong px-3 py-1 type-label font-semibold text-violet-strong"
          >
            <Cloud aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            {AI_METER.images}
          </motion.span>
        ) : null}
      </div>
    </div>
  );
}

/** What runs here at every size, lit in turn from `at`. */
export function AlwaysHere({ at }: { readonly at: number }) {
  return (
    <div data-slot="device-always" className="flex min-w-0 flex-col gap-4">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {JOBS.map((j, i) => (
          <Job key={j.name} name={j.name} icon={j.icon} at={at + i * LIGHT_STEP} />
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <FactLine fact={ALWAYS} />
        <FactLine fact={SPEECH} />
      </div>
    </div>
  );
}
