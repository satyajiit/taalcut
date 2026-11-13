// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variants compare view (P3-V3, U1) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · 2–5 9:16 previews side by side (Original first; two per row under 720 px of room), the
 *   transport over them (Play the hooks, Play all, one Stop), Export all as the screen's one marigold primary, the
 *   short line when fewer were made than asked; in the chat and in the editor (`?compare=`) alike
 * states: making (bones for the variants still coming; Export all off) · ready · playing (one clock) · exporting
 *   (each tile's export line) · short · a tile deleted · error (the command's cause in one alert line) · success
 *   ("Exporting 3 videos. Find them in Exports.", polite) · reduced motion: posters only, no transport, nothing plays
 * motion: none of its own (the previews play; the bars move by transform)
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { ProjectId, Result, TaalcutError, TimelineId } from '@taalcut/core';
import { ArrowUpRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useState, type CSSProperties } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { errorMessage } from '../feedback/error-messages';
import { VERB_ICONS } from '../icons/concepts';
import { HOOK_WINDOW, useHookClock } from './hook-clock';
import { HookTransport } from './hook-transport';
import { useVariantPlayer } from './variant-player';
import { VariantTile, type CompareVariant } from './variant-tile';

type Press = () => Promise<Result<unknown> | undefined>;

export interface VariantsCompareViewProps {
  readonly projectId: ProjectId;
  /** Original first, then the variants in order. */
  readonly variants: readonly CompareVariant[];
  /** Variants still being made: a bones tile each. */
  readonly making?: number;
  /** "Made 3 of 5: …", already in words. */
  readonly short?: string | null;
  /** The editor's page has room for bigger previews. */
  readonly size?: 'card' | 'page';
  readonly hookSeconds?: number;
  readonly onOpen?: (variant: CompareVariant) => void;
  readonly onRender?: (variant: CompareVariant) => Promise<Result<unknown> | undefined>;
  readonly onRenderAll?: Press;
  /** Where the hooks play when this host has no drivable players (the chat → the editor's compare view). */
  readonly onCompare?: () => void;
  readonly className?: string;
}

export function VariantsCompareView({
  projectId,
  variants,
  making = 0,
  short = null,
  size = 'card',
  hookSeconds = HOOK_WINDOW,
  onOpen,
  onRender,
  onRenderAll,
  onCompare,
  className,
}: VariantsCompareViewProps) {
  const { t, i18n } = useLingui();
  const reduced = useReducedMotion() === true;
  const player = useVariantPlayer();
  const [lengths, setLengths] = useState<ReadonlyMap<TimelineId, number | null>>(new Map());
  const clock = useHookClock(
    variants.map((variant) => lengths.get(variant.timelineId) ?? null),
    hookSeconds * 1000,
  );
  const [busy, setBusy] = useState<TimelineId | 'all' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const onLength = useCallback(
    (timelineId: TimelineId, ms: number | null) =>
      setLengths((was) => (was.get(timelineId) === ms ? was : new Map(was).set(timelineId, ms))),
    [],
  );

  const press = async (key: TimelineId | 'all', run: Press, count: number) => {
    setBusy(key);
    setError(null);
    setSent(null);
    try {
      const result = await run();
      if (result && !result.ok) setError(result.error);
      else if (result) setSent(count);
    } finally {
      setBusy(null);
    }
  };

  const playable = !reduced && player !== null && variants.length > 0;
  const whileMaking = making > 0;
  const style = {
    '--cols': variants.length + making,
    '--tile': size === 'page' ? '15rem' : '11rem',
  } as CSSProperties;

  return (
    <div
      data-slot="variants-compare"
      data-mode={clock.mode}
      className={cn('@container flex flex-col gap-4', className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {playable ? (
          <HookTransport
            clock={clock}
            labels={variants.map((variant) => variant.label)}
            hookSeconds={hookSeconds}
          />
        ) : reduced && player ? (
          <p className="m-0 text-xs text-ink-2">{t`Posters only while reduced motion is on.`}</p>
        ) : null}
        {/* The card's way to the editor's compare view, whether or not its previews play here. */}
        {onCompare ? (
          <Button size="sm" variant="ghost" onClick={onCompare}>
            {t`Compare side by side`}
            <ArrowUpRight aria-hidden />
          </Button>
        ) : null}
        {onRenderAll ? (
          <Button
            size="sm"
            variant="primary"
            data-slot="render-all"
            className="ms-auto"
            disabled={whileMaking || busy !== null}
            loading={busy === 'all'}
            icon={VERB_ICONS.export}
            onClick={() => void press('all', onRenderAll, variants.length)}
          >
            {t`Export all`}
          </Button>
        ) : null}
      </div>
      <ul
        className="m-0 grid list-none grid-cols-[repeat(2,minmax(0,var(--tile)))] gap-x-3 gap-y-5 p-0 @min-[45rem]:grid-cols-[repeat(var(--cols),minmax(0,var(--tile)))]"
        style={style}
      >
        {variants.map((variant, index) => (
          <VariantTile
            key={variant.timelineId}
            projectId={projectId}
            variant={variant}
            playing={playable && clock.playing(index)}
            epoch={clock.epoch}
            still={reduced}
            onLength={onLength}
            onOpen={onOpen ? () => onOpen(variant) : undefined}
            onRender={onRender ? () => void press(variant.timelineId, () => onRender(variant), 1) : undefined}
            rendering={busy === variant.timelineId}
            disabled={busy !== null}
          />
        ))}
        {Array.from({ length: making }, (_, index) => (
          <VariantTile
            key={`making-${index}`}
            projectId={projectId}
            variant={null}
            playing={false}
            epoch={0}
            still
          />
        ))}
      </ul>
      {short ? <p className="m-0 text-sm text-ink-2">{short}</p> : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
      <p role="status" className={cn('m-0 text-sm text-ink-2', sent === null && 'sr-only')}>
        {sent === null ? null : (
          <Plural
            value={sent}
            one="Exporting it. Find it in Exports."
            other="Exporting # videos. Find them in Exports."
          />
        )}
      </p>
    </div>
  );
}
