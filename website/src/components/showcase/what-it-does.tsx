// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: what a feature does · mode: Persuade · system: WEB2 Remix Vernacular
 * states: each row: resting (the server HTML: its words and its vignette's finished scene) · arriving (the section's
 *   rise, then the vignette acts its fact out once) · pointed at (a mouse or trackpad over the row plays the vignette
 *   again; the icon leans) · reduced motion (the finished scene, still). No row is a control.
 * The feature's facts, the ones search and AI engines read, as a description list of short rows: each fact's icon in
 * its chip, its label and its words, and beside them a small drawn scene of the fact working. Never a text list, never
 * a grid of equal cards: rows with hairlines between them. */

import {
  AudioLines,
  Captions,
  Check,
  FileInput,
  Gauge,
  Images,
  ListChecks,
  type LucideIcon,
  Music,
  Repeat,
  ScanSearch,
  Search,
  Smartphone,
  Sticker as StickerIcon,
  Undo2,
  Upload,
  Wrench,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { motion } from 'motion/react';
import { ARRIVE_ITEM, Section } from '#components/ui/section';
import type { Fact } from '#content/schema';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { cn } from '#lib/cn';
import { type FeatureJob, JOB_CHIP } from './look';
import type { Scene } from './vignette';
import { useScene } from './vignette';
import {
  CaptionScene,
  CheckScene,
  ExportScene,
  GraphicScene,
  StepsScene,
  ThinkScene,
  TimelineScene,
  UndoScene,
} from './vignettes-make';
import { FixScene, MusicScene, ReadScene, SourcesScene } from './vignettes-reel';
import { KeepScene, RefillScene, StartersScene } from './templates/scenes';
import { IndexScene, PhoneScene, PickScene, SearchScene } from './vignettes-roll';
import { IMPORT_ROWS } from './import/entry';
import { SHORTS_ROWS } from './shorts/entry';
import { EDITS_ROWS } from './instagram-edits/entry';
import { LAUNCH_ROWS } from './launch-videos/entry';
import { PRODUCT_ROWS } from './product-videos/entry';
import { PLUGINS_ROWS } from './plugins/entry';

interface Row {
  readonly icon: LucideIcon;
  readonly Scene: ComponentType<Scene>;
}

/** Each feature's facts in order (#content/features), with the icon and the scene each one takes. */
const ROWS: Readonly<Record<string, readonly Row[]>> = {
  'reel-breakdown': [
    { icon: FileInput, Scene: SourcesScene },
    { icon: ScanSearch, Scene: ReadScene },
    { icon: Wrench, Scene: FixScene },
    { icon: Music, Scene: MusicScene },
  ],
  'auto-pick': [
    { icon: Smartphone, Scene: PhoneScene },
    { icon: Images, Scene: IndexScene },
    { icon: Search, Scene: SearchScene },
    { icon: ICONS.clip, Scene: PickScene },
  ],
  templates: [
    { icon: AudioLines, Scene: KeepScene },
    { icon: ICONS.template, Scene: StartersScene },
    { icon: Repeat, Scene: RefillScene },
  ],
  agent: [
    { icon: Check, Scene: StepsScene },
    { icon: ListChecks, Scene: CheckScene },
    { icon: Undo2, Scene: UndoScene },
    { icon: Gauge, Scene: ThinkScene },
  ],
  editor: [
    { icon: ICONS.trim, Scene: TimelineScene },
    { icon: Captions, Scene: CaptionScene },
    { icon: StickerIcon, Scene: GraphicScene },
    { icon: Upload, Scene: ExportScene },
  ],
  'import': IMPORT_ROWS,
  'shorts': SHORTS_ROWS,
  'instagram-edits': EDITS_ROWS,
  'launch-videos': LAUNCH_ROWS,
  'product-videos': PRODUCT_ROWS,
  'plugins': PLUGINS_ROWS,
};

function FactRow({ fact, row, job }: { readonly fact: Fact; readonly row: Row; readonly job: FeatureJob }) {
  const { ref, key, scene, onPointerEnter, replay } = useScene<HTMLDivElement>();
  const [label, value] = fact;
  const Icon = row.icon;
  const Scene = row.Scene;
  return (
    <motion.div
      ref={ref}
      variants={ARRIVE_ITEM}
      onPointerEnter={onPointerEnter}
      onFocusCapture={replay}
      className="grid grid-cols-1 items-center gap-x-10 gap-y-2 border-t border-rule py-7 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
    >
      <dt className="flex min-w-0 items-center gap-4 type-site-subhead text-ink md:self-end">
        <span
          aria-hidden
          className={cn(
            'inline-grid size-11 shrink-0 -rotate-3 place-items-center rounded-xl shadow-sticker',
            JOB_CHIP[job],
          )}
        >
          <Icon strokeWidth={ICON_STROKE} className="size-5" />
        </span>
        {label}
      </dt>
      <dd className="m-0 max-w-[34em] ps-15 type-site-body text-pretty text-ink-2 md:self-start">{value}</dd>
      <dd aria-hidden className="m-0 mt-3 md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0">
        <Scene key={key} {...scene} />
      </dd>
    </motion.div>
  );
}

export function WhatItDoes({
  slug,
  facts,
  job,
}: {
  readonly slug: string;
  readonly facts: readonly Fact[];
  readonly job: FeatureJob;
}) {
  const rows = ROWS[slug] ?? [];
  return (
    <Section id="what-it-does" heading="What it does" tone="sunken">
      <dl className="m-0 flex flex-col">
        {facts.map((fact, i) => {
          const row = rows[i];
          return row ? <FactRow key={fact[0]} fact={fact} row={row} job={job} /> : null;
        })}
      </dl>
    </Section>
  );
}
