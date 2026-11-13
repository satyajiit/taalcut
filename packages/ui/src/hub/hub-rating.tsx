// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: hub rating · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 *   · "4.6 ★ (38)" through Intl, or a "New" chip in sky (what is new: UX3 kinds) under 3 ratings; the star is ink,
 *   never the marigold of the screen's one primary action
 * states: rated · new (under 3, or none) · n/a: static text, no interactive states
 */
import { useLingui } from '@lingui/react/macro';
import type { HubRating } from '@taalcut/core';
import { Star } from 'lucide-react';
import { Chip } from '../components/badge';
import { cn } from '#lib/cn';
import { isNewRating, ratingLabel } from './hub-words';

export function HubRatingText({
  rating,
  className,
}: {
  readonly rating: HubRating | null;
  readonly className?: string;
}) {
  const { t, i18n } = useLingui();
  const label = ratingLabel(i18n, rating);
  if (rating === null || isNewRating(rating))
    return (
      <Chip data-slot="hub-rating" data-new="" className={cn('bg-new-soft text-new-strong', className)}>
        <span aria-hidden>{t`New`}</span>
        <span className="sr-only">{label}</span>
      </Chip>
    );
  const mean = i18n.number(rating.mean, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const count = i18n.number(rating.count);
  return (
    <span
      data-slot="hub-rating"
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center gap-1 text-sm text-ink tabular-nums', className)}
    >
      <span aria-hidden>{mean}</span>
      <Star aria-hidden className="size-3.5 fill-current text-ink-2" />
      <span aria-hidden className="text-ink-3">
        ({count})
      </span>
    </span>
  );
}
