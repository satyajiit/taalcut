// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variant render line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a tile's newest export in one line; a background job, so it runs neutral (DESIGN.md
 *   "Running"): ink-2 words, a neutral bar scaled with transform, the percent in tabular digits
 * states: not interactive · queued (spinner, "Waiting to start") · running (stage, bar, percent) · ready (green check,
 *   "Exported") · needs a look (warning mark) · failed (vermilion) · stopped (ink-3) · reduced motion: the bar's
 *   transition is the base layer's
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { RenderSnapshot } from '@taalcut/core';
import { CircleAlert, CircleCheck, CircleMinus, CircleX, LoaderCircle } from 'lucide-react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { renderStageLabel } from '../make/render-words';

const RUNNING = new Set<RenderSnapshot['status']>(['queued', 'rendering', 'checking', 'fixing']);

export function RenderLine({ render, label }: { render: RenderSnapshot; label: string }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const { status } = render;
  if (RUNNING.has(status)) {
    const fraction = status === 'queued' ? null : (render.progress?.fraction ?? null);
    const stage = renderStageLabel(i18n, render.progress?.stageKey, status);
    const percent = fraction === null ? null : format.percent(fraction);
    return (
      <div data-slot="variant-render" data-status={status} className="flex flex-col gap-1">
        <p className="m-0 flex items-center gap-1.5 text-xs text-ink-2">
          {fraction === null ? <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin" /> : null}
          <span className="min-w-0 truncate">{stage}</span>
          {percent ? <span className="ms-auto text-ink tabular-nums">{percent}</span> : null}
        </p>
        <div
          role="progressbar"
          aria-label={t`Export of ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
          aria-valuetext={percent ? `${stage}, ${percent}` : stage}
          className="h-1 overflow-hidden rounded-pill bg-hover"
        >
          <span
            className="block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)"
            style={{ transform: `scaleX(${fraction ?? 0})` }}
          />
        </div>
      </div>
    );
  }
  const Icon =
    status === 'ready'
      ? CircleCheck
      : status === 'needsAttention'
        ? CircleAlert
        : status === 'failed'
          ? CircleX
          : CircleMinus;
  return (
    <p
      data-slot="variant-render"
      data-status={status}
      className={cn(
        'm-0 flex items-center gap-1.5 text-xs',
        status === 'ready' && 'text-ink',
        status === 'needsAttention' && 'text-warning-strong',
        status === 'failed' && 'text-danger-strong',
        status === 'cancelled' && 'text-ink-2',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'size-3.5 shrink-0',
          status === 'ready' && 'text-success-strong',
          status === 'cancelled' && 'text-ink-3',
        )}
      />
      {renderStageLabel(i18n, null, status)}
    </p>
  );
}
