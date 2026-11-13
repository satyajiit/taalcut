// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: tabs · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * in-page panels on Radix Tabs: the list is the kit's pill, the open tab on the shared raised thumb with its
 *   rule-strong edge, which glides between tabs (--dur-short, --ease-out, transform only), as Segmented's and
 *   ViewLinks' do. Arrow keys move between tabs (Radix).
 * states: default (ink-2, icon ink-3) · hover (ink) · focus (base ring, instant) · active (pressed: ink) · current
 *   (data-state=active: the thumb, ink) · disabled (ink-disabled, skipped) · loading, error, success: n/a (the panel
 *   says its own)
 * reduced motion: the thumb moves at once (base.css) */
import { Tabs as TabsPrimitive } from 'radix-ui';
import { useRef, type ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE } from '#lib/motion-classes';
import { SegmentThumb, useThumb } from './segment-thumb';

/** In-page panels. For moving between pages use ViewLinks (router links), not tabs. */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />;
}

/** The pill of tabs, with the thumb under the open one. */
export function TabsList({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const list = useRef<HTMLDivElement>(null);
  const thumb = useThumb(list, '[role=tab][data-state=active]');
  return (
    <TabsPrimitive.List
      ref={list}
      data-slot="tabs-list"
      className={cn(
        'relative inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-pill border border-rule bg-sunken p-0.5',
        className,
      )}
      {...props}
    >
      {thumb ? <SegmentThumb {...thumb} /> : null}
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Positioned, so its words paint above the thumb.
        'relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-3 type-label whitespace-nowrap text-ink-2',
        HOVER_EASE,
        'hover:text-ink active:text-ink data-[state=active]:text-ink',
        'disabled:cursor-not-allowed disabled:text-ink-disabled',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3 data-[state=active]:[&_svg]:text-ink-2',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1', className)} {...props} />;
}
