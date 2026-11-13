// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
/* Impeccable · Operate · DESIGN.md: quiet context, real format shapes and active-work arrival.
 * States: current product data; motion is skipped when reduced motion is requested. */
import { RationalTime, type ProductInput, type VideoAspect } from '@taalcut/core';
import { CONCEPT_ICONS, DUR, EASE_OUT, motion, useReducedMotion, UserContent } from '@taalcut/ui';
import type { ReactNode } from 'react';

/** A view change keeps the product context still while its active work arrives. */
export function ProductArrival({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0.6, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : DUR.short, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

export function ProductFacts({ product }: { product: ProductInput }) {
  const { t, i18n } = useLingui();
  const Duration = CONCEPT_ICONS.duration;
  const Source = CONCEPT_ICONS.source;
  const duration = i18n.number(RationalTime.toSeconds(product.preferences.duration));
  const sources = i18n.number(product.sources.length);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 type-meta text-ink-2">
      <span className="inline-flex items-center gap-2">
        <Duration aria-hidden className="size-3.5" />
        {t`${duration} seconds`}
      </span>
      <UserContent>{product.preferences.formats.join(' · ')}</UserContent>
      <span className="inline-flex items-center gap-2">
        <Source aria-hidden className="size-3.5" />
        {t`Sources: ${sources}`}
      </span>
    </div>
  );
}

/** These are format diagrams, never placeholders for a video's poster. */
export function ProductFormatSummary({ formats }: { formats: readonly VideoAspect[] }) {
  const { t } = useLingui();
  return (
    <div aria-label={t`Video formats`} className="flex flex-wrap items-end gap-4">
      {formats.map((format) => (
        <div key={format} className="flex flex-col items-center gap-2">
          <span
            aria-hidden
            className="block h-9 rounded-sm border border-ink-3 bg-well"
            style={{ aspectRatio: format.replace(':', '/') }}
          />
          <UserContent className="type-caption text-ink-2">{format}</UserContent>
        </div>
      ))}
    </div>
  );
}

export function ProductHeading({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 type-page-title text-balance text-ink">{title}</h2>
        <p className="mt-2 mb-0 max-w-prose type-body text-pretty text-ink-2">{children}</p>
      </div>
      {action}
    </div>
  );
}
