// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: shot thumb · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.3
 * a 9:16 frame on the viewer grey (the same grey in both themes, never carries text); the picture fades in once it
 *   has loaded; who chose it rides on the frame's lower edge: the AI mark (violet) or "You" (teal), word or icon
 * states: empty (the grey alone) · loading (the grey, then the picture fades in over --dur-micro) · ready ·
 *   selected (marigold ring) · not interactive itself: the button round it carries hover, focus, active, disabled
 * pre-emit critique: P5 H4 E5 S4 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import { motion } from 'motion/react';
import { useState } from 'react';
import { AiMark } from '../components/ai-mark';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';

export type ShotThumbSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Readonly<Record<ShotThumbSize, string>> = {
  xs: 'w-7',
  sm: 'w-10',
  md: 'w-14',
  lg: 'w-24',
};

export interface ShotThumbProps {
  /** A URL the CSP allows; null keeps the viewer grey. */
  url: string | null | undefined;
  /** Usually empty: the words beside the frame name it. */
  alt?: string;
  /**
   * The id of the words that name it instead of `alt`, when they hold content an alt can't keep as written (a
   * design's name, the model's words): `StillName`.
   */
  labelledBy?: string;
  size?: ShotThumbSize;
  /** Who chose it: the AI (violet mark) or you (teal "You"). */
  marker?: 'ai' | 'you' | null;
  selected?: boolean;
  /** Dimmed under work in progress (a swap updating). */
  dimmed?: boolean;
  /** Shared-layout id: a swap moves the frame between places instead of cutting. */
  layoutId?: string;
  className?: string;
}

/**
 * "A still of <name>" for a ShotThumb's `labelledBy`: the words translated, the name (content) kept as written and
 * marked as content. Hidden from reading in place: the still reads it as its name.
 */
export function StillName({ id, name }: { readonly id: string; readonly name: string }) {
  return (
    <span id={id} aria-hidden className="sr-only">
      <Trans>
        A still of{' '}
        <span data-user-content translate="no">
          {name}
        </span>
      </Trans>
    </span>
  );
}

/** A shot's frame at 9:16 on the viewer grey. */
export function ShotThumb({
  url,
  alt = '',
  labelledBy,
  size = 'sm',
  marker = null,
  selected = false,
  dimmed = false,
  layoutId,
  className,
}: ShotThumbProps) {
  const { t } = useLingui();
  const [shown, setShown] = useState<string | null>(null);
  const loaded = url !== null && url !== undefined && shown === url;
  const frame = (
    <span
      className={cn(
        'tc-viewer relative block aspect-[9/16] overflow-hidden rounded-md transition-opacity duration-(--dur-short) ease-(--ease-out)',
        selected && 'ring-2 ring-primary-strong ring-offset-1 ring-offset-canvas',
        dimmed && 'opacity-50',
      )}
    >
      {url ? (
        <img
          src={url}
          alt={labelledBy ? undefined : alt}
          aria-labelledby={labelledBy}
          draggable={false}
          decoding="async"
          onLoad={() => setShown(url)}
          className={cn(
            'absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-(--dur-micro) ease-(--ease-out)',
            loaded && 'opacity-100',
          )}
        />
      ) : null}
    </span>
  );
  return (
    <span data-slot="shot-thumb" className={cn('relative inline-block shrink-0', SIZES[size], className)}>
      {layoutId ? (
        <motion.span
          layoutId={layoutId}
          transition={{ duration: DUR.short, ease: EASE_OUT }}
          className="block"
        >
          {frame}
        </motion.span>
      ) : (
        frame
      )}
      {marker === 'ai' ? (
        <span className="absolute -bottom-1.5 left-1/2 inline-flex h-4 -translate-x-1/2 items-center rounded-pill bg-raised px-1 ring-1 ring-rule-subtle">
          <AiMark label={t`AI pick`} className="size-2.5" />
        </span>
      ) : marker === 'you' ? (
        <span className="absolute -bottom-1.5 left-1/2 inline-flex h-4 -translate-x-1/2 items-center rounded-pill bg-you-soft px-1.5 text-2xs leading-none font-semibold text-you-strong ring-1 ring-raised">
          {t`You`}
        </span>
      ) : null}
    </span>
  );
}
