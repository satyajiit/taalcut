// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the features index · mode: Persuade · system: WEB2 Remix Vernacular
 * One list in two parts (FEATURE_GROUPS): the five parts of making it like the reel you saved, then More ways to make.
 *   Each part opens with its heading row, on a sunken panel: a part bar (eleven segments, this part's in ink, the
 *   other's empty, the reel world's progress bar as the motif), the h2, its lead, and a link to each of its features'
 *   rows by its glyph and name. Then its features as large rows that change shape with the work, never a grid of equal
 *   cards: each its name (an h3 under the part), its summary, two of its facts as icon rows, a link to its page, and a
 *   live fragment of its showcase in a coded app window with a sticker on its edge. The reel's row stands the reel
 *   beside its lanes; the roll's window leads its row; the template runs the full width under its words; the chat
 *   keeps a chat's narrow window; the timeline leads the last row of the first part; the new six take the same shapes
 *   (ENTRIES), the stickers' tilt alternating down the whole list
 * states: the links: default · hover (the arrow steps on, the underline darkens; a part's link takes the control's
 *   hover face) · focus (base ring) · active (n/a); the stickers pop once and lean; the fragments' own (fragments.tsx
 *   and each feature's entry.tsx); a part's heading row and each row's halves rise in on arrival (Rise) */

import type { Route } from 'next';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { Kaatu } from '#components/kaatu/kaatu';
import { Sticker } from '#components/ui/sticker';
import { FEATURE_GROUPS, FEATURE_STICKERS } from '#content/features';
import type { Feature } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import {
  AgentFragment,
  AutoPickFragment,
  BreakdownFragment,
  EditorFragment,
  TemplatesFragment,
} from './fragments';
import { LookGlyph } from './icon-chip';
import { JOB_TEXT, lookOf } from './look';
import { Rise } from './rise';
import { ImportFragment } from './import/entry';
import { ShortsFragment } from './shorts/entry';
import { EditsFragment } from './instagram-edits/entry';
import { LaunchFragment } from './launch-videos/entry';
import { ProductFragment } from './product-videos/entry';
import { PluginsFragment } from './plugins/entry';

type Shape = 'words-left' | 'demo-left' | 'stacked' | 'narrow-demo';

interface Entry {
  readonly shape: Shape;
  readonly Fragment: ComponentType;
  /** Where the row's sticker hangs on its window. */
  readonly sticker: string;
}

const ENTRIES: Readonly<Record<string, Entry>> = {
  'reel-breakdown': { shape: 'words-left', Fragment: BreakdownFragment, sticker: '-top-4 right-6' },
  'auto-pick': { shape: 'demo-left', Fragment: AutoPickFragment, sticker: '-bottom-4 right-8' },
  templates: { shape: 'stacked', Fragment: TemplatesFragment, sticker: '-top-4 right-10' },
  agent: { shape: 'narrow-demo', Fragment: AgentFragment, sticker: '-bottom-4 -left-3' },
  editor: { shape: 'demo-left', Fragment: EditorFragment, sticker: '-top-4 right-4' },
  'import': { shape: 'demo-left', Fragment: ImportFragment, sticker: '-top-4 right-6' },
  'shorts': { shape: 'words-left', Fragment: ShortsFragment, sticker: '-bottom-4 right-8' },
  'instagram-edits': { shape: 'demo-left', Fragment: EditsFragment, sticker: '-top-4 right-10' },
  'launch-videos': { shape: 'stacked', Fragment: LaunchFragment, sticker: '-top-4 right-6' },
  'product-videos': { shape: 'words-left', Fragment: ProductFragment, sticker: '-bottom-4 -left-3' },
  'plugins': { shape: 'narrow-demo', Fragment: PluginsFragment, sticker: '-top-4 right-4' },
};

const WORDS: Record<Shape, string> = {
  'words-left': 'lg:col-span-4',
  'demo-left': 'lg:col-span-4 lg:order-2',
  stacked: 'lg:col-span-12 lg:grid lg:grid-cols-12 lg:gap-x-10',
  'narrow-demo': 'lg:col-span-5',
};
const DEMO: Record<Shape, string> = {
  'words-left': 'lg:col-span-8',
  'demo-left': 'lg:col-span-8 lg:order-1',
  stacked: 'lg:col-span-12',
  'narrow-demo': 'lg:col-span-6 lg:col-start-7',
};

function Words({ feature, shape }: { readonly feature: Feature; readonly shape: Shape }) {
  const Arrow = ICONS.next;
  const id = `feature-${feature.slug}`;
  const look = lookOf(feature.slug);
  const facts = feature.facts.slice(0, 2);
  return (
    <Rise className={cn('flex min-w-0 flex-col gap-5', WORDS[shape])}>
      <div className={cn('flex items-start gap-4', shape === 'stacked' && 'lg:col-span-5')}>
        <h3 id={id} className="m-0 max-w-[14ch] type-site-headline text-balance text-ink">
          {feature.name}
        </h3>
      </div>
      <div className={cn('flex flex-col gap-5', shape === 'stacked' && 'lg:col-span-7')}>
        <p className="m-0 max-w-[34em] type-site-lead text-ink-2">{feature.summary}</p>
        <dl className="m-0 flex max-w-[34em] flex-col gap-2.5">
          {facts.map(([label, value]) => (
            <div key={label} className="flex items-start gap-2.5">
              <dt
                className={cn(
                  'inline-flex h-[1lh] shrink-0 items-center type-site-body font-semibold whitespace-nowrap',
                  JOB_TEXT[look.job],
                )}
              >
                <ICONS.approve aria-hidden strokeWidth={ICON_STROKE + 0.5} className="me-1.5 size-4" />
                <span className="text-ink">{label}</span>
              </dt>
              <dd className="m-0 type-site-body text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
        <Link
          href={`/features/${feature.slug}/` as Route}
          aria-label={`See how it works: ${feature.name}`}
          className="group inline-flex w-fit items-center gap-2 rounded-md type-site-body font-semibold whitespace-nowrap text-ink underline decoration-rule-strong decoration-2 underline-offset-4 hover:decoration-ink"
        >
          See how it works
          <Arrow
            aria-hidden
            strokeWidth={ICON_STROKE}
            className="size-4.5 transition-transform duration-(--dur-micro) ease-(--ease-out) group-hover:translate-x-1 motion-reduce:transition-none"
          />
        </Link>
      </div>
    </Rise>
  );
}

type Group = (typeof FEATURE_GROUPS)[number];

/** The part bar: one segment a feature, this part's filled in ink, the other part's empty. */
function PartBar({ sizes, part }: { readonly sizes: readonly number[]; readonly part: number }) {
  return (
    <span aria-hidden data-slot="part-bar" className="flex w-full max-w-[26rem] gap-2.5">
      {sizes.map((size, p) => (
        <span key={p} className="flex gap-1" style={{ flexGrow: size }}>
          {Array.from({ length: size }, (_, i) => (
            <span key={i} className={cn('h-1.5 flex-1 rounded-pill', p === part ? 'bg-ink' : 'bg-rule')} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** A part's heading row: the part bar, its h2 and lead, and a way to each of its rows. */
function GroupHead({ group, features, part, sizes }: { readonly group: Group; readonly features: readonly Feature[]; readonly part: number; readonly sizes: readonly number[] }) {
  return (
    <Rise className="grid grid-cols-1 gap-x-12 gap-y-6 rounded-reel bg-sunken px-5 py-8 sm:px-10 sm:py-10 lg:grid-cols-12 lg:px-12 lg:py-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-6">
        <PartBar sizes={sizes} part={part} />
        <h2 id={`group-${group.id}`} className="m-0 max-w-[16ch] type-site-headline text-balance text-ink">
          {group.title}
        </h2>
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-6 lg:justify-end">
        <p className="m-0 max-w-[34em] type-site-lead text-ink-2">{group.lead}</p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {features.map((f) => {
            const look = lookOf(f.slug);
            return (
              <li key={f.slug}>
                <a
                  href={`#${f.slug}`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-pill bg-raised px-3.5 py-1.5 type-label font-semibold whitespace-nowrap text-ink shadow-xs ring-1 ring-rule-subtle transition-colors duration-(--dur-micro) hover:bg-control-hover active:bg-control-pressed"
                >
                  <LookGlyph icon={look.icon} className={cn('size-4 shrink-0', JOB_TEXT[look.job])} />
                  {f.name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Rise>
  );
}

function Row({ feature, first, order }: { readonly feature: Feature; readonly first: boolean; readonly order: number }) {
  const entry = ENTRIES[feature.slug];
  if (!entry) return null;
  const { shape, Fragment, sticker } = entry;
  const look = lookOf(feature.slug);
  const words = FEATURE_STICKERS[feature.slug]?.[0];
  const style = look.stickers[0];
  return (
    <li
      id={feature.slug}
      aria-labelledby={`feature-${feature.slug}`}
      data-feature={feature.slug}
      className={cn(
        'grid scroll-mt-4 grid-cols-1 items-center gap-x-12 gap-y-10 lg:grid-cols-12',
        first ? 'pt-16 pb-24' : 'border-t border-rule-subtle py-24',
      )}
    >
      <Words feature={feature} shape={shape} />
      <Rise delay={0.08} className={cn('relative min-w-0', DEMO[shape])}>
        <Fragment />
        {feature.slug === 'agent' ? (
          <Kaatu pose={look.pose} size={88} interactive className="absolute -top-[4.75rem] right-10 z-10" />
        ) : null}
        {words && style ? (
          <span className={cn('pointer-events-none absolute z-10 max-sm:hidden [&>*]:pointer-events-auto', sticker)}>
            <Sticker field={style.field} {...(style.icon === 'ai' ? {} : { icon: style.icon })} tilt={order % 2 === 0 ? -4 : 4}>
              {words}
            </Sticker>
          </span>
        ) : null}
      </Rise>
    </li>
  );
}

export function FeatureIndex({ features }: { readonly features: readonly Feature[] }) {
  const groups = FEATURE_GROUPS.map((group) => ({ group, items: features.filter((f) => f.group === group.id && f.slug in ENTRIES) }));
  const sizes = groups.map((g) => g.items.length);
  return (
    <div className="px-gutter pb-section-bottom">
      <div className="mx-auto flex max-w-site flex-col">
        {groups.map(({ group, items }, part) => {
          const before = sizes.slice(0, part).reduce((a, b) => a + b, 0);
          return (
            <section key={group.id} aria-labelledby={`group-${group.id}`} data-feature-group={group.id}>
              <GroupHead group={group} features={items} part={part} sizes={sizes} />
              <ol start={before + 1} className="m-0 flex list-none flex-col p-0">
                {items.map((feature, i) => (
                  <Row key={feature.slug} feature={feature} first={i === 0} order={before + i} />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
