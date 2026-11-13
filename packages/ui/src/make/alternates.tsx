// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: alternates strip · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the shots that could fill a slot instead, as 9:16 frames; pressing one swaps it in
 * states: default · hover (hover surface round the frame) · focus (base ring, instant; roving inside a grid) · active
 *   (pressed surface) · disabled (the run ended, the clip is locked or gone: aria-disabled, the reason is the
 *   caller's line) · loading (the pressed one dims and is busy; "Find something else" spins) · error (the caller's
 *   error line under the strip) · success (silent: the frame moves into the pick's place) · empty (emptyAction)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import type { ShotFrame } from '../cards/card-data';
import { ShotThumb, type ShotThumbSize } from './shot-thumb';

export interface AlternateItem {
  readonly key: string;
  /** Undefined while it loads (the viewer grey shows). */
  readonly frame?: ShotFrame | undefined;
  /** Shared-layout id, so a swap moves the frame into the pick's place. */
  readonly layoutId?: string;
}

export interface AlternatesStripProps {
  items: readonly AlternateItem[];
  onSwap: (index: number) => void;
  onFindMore?: () => void;
  finding?: boolean;
  disabled?: boolean;
  /** The index whose swap is in flight. */
  swapping?: number | null;
  /** Instead of the frames when there are none. */
  emptyAction?: ReactNode;
  size?: ShotThumbSize;
  /**
   * Inside a grid: the one item that is the tab stop (null: none of these; `items.length` is "Find something
   * else"). Undefined: each is tabbable.
   */
  tabStop?: number | null;
  onItemKeyDown?: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Names the group for screen readers; default "Other shots". */
  label?: string;
  className?: string;
}

export function AlternatesStrip({
  items,
  onSwap,
  onFindMore,
  finding = false,
  disabled = false,
  swapping = null,
  emptyAction,
  size = 'md',
  tabStop,
  onItemKeyDown,
  label,
  className,
}: AlternatesStripProps) {
  const { t } = useLingui();
  return (
    <div
      role="group"
      aria-label={label ?? t`Other shots`}
      data-slot="alternates"
      className={cn('flex flex-wrap items-end gap-2', className)}
    >
      {items.length === 0 && emptyAction ? emptyAction : null}
      {items.map((item, index) => {
        const busy = swapping === index;
        return (
          <button
            key={item.key}
            type="button"
            data-alternate={index}
            tabIndex={tabStop === undefined ? undefined : tabStop === index ? 0 : -1}
            aria-disabled={disabled || busy || undefined}
            aria-busy={busy || undefined}
            onKeyDown={(event) => onItemKeyDown?.(index, event)}
            onClick={() => {
              if (!disabled && swapping === null) onSwap(index);
            }}
            className={cn(
              'rounded-md p-0.5 transition-colors duration-(--dur-micro) ease-(--ease-out)',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-hover active:bg-pressed',
            )}
          >
            <ShotThumb url={item.frame?.url} size={size} dimmed={busy} layoutId={item.layoutId} />
            <span className="sr-only">
              {t`Swap in this shot`}
              {item.frame ? (
                <>
                  {': '}
                  <span translate="no" data-user-content>
                    {item.frame.name}
                  </span>
                </>
              ) : null}
            </span>
          </button>
        );
      })}
      {onFindMore ? (
        <Button
          size="sm"
          variant="ghost"
          loading={finding}
          disabled={disabled}
          onClick={onFindMore}
          className="self-center"
          data-alternate={items.length}
          tabIndex={tabStop === undefined ? undefined : tabStop === items.length ? 0 : -1}
          onKeyDown={(event) => onItemKeyDown?.(items.length, event)}
        >
          {finding ? null : <Search aria-hidden />}
          {t`Find something else`}
        </Button>
      ) : null}
    </div>
  );
}
