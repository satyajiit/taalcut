// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: image-generation · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · in-flight and completed image generation surface with interactive dither field,
 *   rotating 2x2 pixel status mark, provider logo and blur-to-sharp reveal (modeled after beui.dev/r/image-generation)
 * states: queued · generating · refining · complete · error (with optional Retry action) */

import { useLingui } from '@lingui/react/macro';
import { RotateCcw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { CrossfadeText } from '../components/crossfade-text';
import { ProviderLogo } from '#components/provider-logo';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { UserContent } from '../cards/card-frame';
import { providerLabel } from '../cards/labels';
import { DitherField, DitherMark, type ImageGenerationStatus } from './dither-field';

export type ImageGenerationAspectRatio = '9:16' | '1:1' | '16:9' | '4:3' | '3:4';

const ASPECT_CLASSES: Readonly<Record<ImageGenerationAspectRatio, string>> = {
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
};

export interface ImageGenerationProps {
  children?: ReactNode;
  status?: ImageGenerationStatus;
  aspectRatio?: ImageGenerationAspectRatio;
  provider?: string;
  model?: string;
  width?: number;
  height?: number;
  prompt?: string;
  errorMessage?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * In-flight and completed image generation card surface. Shows an animated
 * dot-matrix dither field while queued/generating/refining, then smoothly
 * reveals the finished image (when passed as `children`).
 */
export function ImageGeneration({
  children,
  status = 'generating',
  aspectRatio = '9:16',
  provider,
  model,
  width,
  height,
  prompt,
  errorMessage,
  onRetry,
  className,
}: ImageGenerationProps) {
  const { t, i18n } = useLingui();
  const reducedMotion = useReducedMotion();

  const isComplete = status === 'complete';
  const isError = status === 'error';
  const isActive = status === 'queued' || status === 'generating' || status === 'refining';

  const statusText =
    status === 'queued'
      ? t`Queued`
      : status === 'generating'
        ? t`Generating image`
        : status === 'refining'
          ? t`Refining details`
          : status === 'complete'
            ? t`Image ready`
            : t`Generation failed`;

  const resolvedProviderLabel = provider ? providerLabel(i18n, provider) : null;

  return (
    <div
      data-slot="image-generation"
      data-status={status}
      aria-busy={isActive || undefined}
      className={cn('flex w-full flex-col gap-2', className)}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 px-0.5 text-xs">
        <div
          className={cn(
            'flex min-w-0 items-center gap-2 font-medium transition-colors duration-(--dur-short)',
            isError ? 'text-danger' : isComplete ? 'text-ink-2' : 'text-ink',
          )}
        >
          <DitherMark status={status} />
          <CrossfadeText value={status}>{statusText}</CrossfadeText>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-2xs text-ink-3">
          {provider ? (
            <span className="inline-flex items-center gap-1 text-ink-2">
              <ProviderLogo provider={provider} size="xs" framed={false} />
              <UserContent translate="no">{model ?? resolvedProviderLabel}</UserContent>
            </span>
          ) : null}
          {width && height ? (
            <span className="font-mono tabular-nums">
              {i18n.number(width)} × {i18n.number(height)}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'relative w-full overflow-hidden rounded-lg border border-rule-subtle bg-well',
          ASPECT_CLASSES[aspectRatio],
        )}
      >
        {children ? (
          <motion.div
            initial={false}
            animate={
              isComplete ? { opacity: 1, scale: 1 } : { opacity: 0, scale: reducedMotion ? 1 : 1.03 }
            }
            transition={{ duration: reducedMotion ? REDUCED_FADE : DUR.long, ease: EASE_OUT }}
            className={cn(
              'size-full transition-[filter] duration-(--dur-long) ease-(--ease-out) [&>img]:size-full [&>img]:object-cover',
              !isComplete && !reducedMotion && 'blur-lg saturate-50',
            )}
          >
            {children}
          </motion.div>
        ) : null}

        <AnimatePresence initial={false}>
          {!isComplete ? (
            <motion.div
              key="dither-overlay"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
              className="absolute inset-0"
            >
              <DitherField active={isActive} />

              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,var(--color-canvas)_100%)] opacity-55"
              />

              {isError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-canvas/80 p-4 text-center backdrop-blur-xs">
                  <p className="m-0 max-w-52 text-xs leading-relaxed text-ink-2">
                    {errorMessage ? <UserContent>{errorMessage}</UserContent> : t`Couldn’t generate this image.`}
                  </p>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-rule bg-raised px-2.5 py-1 text-xs font-medium text-ink shadow-xs transition-colors duration-(--dur-micro) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <RotateCcw aria-hidden className="size-3" />
                      {t`Try again`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {prompt ? (
        <p className="m-0 line-clamp-2 px-0.5 text-xs leading-relaxed text-ink-3">
          <UserContent>{prompt}</UserContent>
        </p>
      ) : null}
    </div>
  );
}
