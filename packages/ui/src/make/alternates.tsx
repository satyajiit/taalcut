// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: alternates strip · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the shots that could fill a slot instead, as 9:16 frames; pressing one swaps it in
 * states: default · hover (hover surface round the frame) · focus (base ring, instant; roving inside a grid) · active
 *   (pressed surface) · disabled (the run ended, the clip is locked or gone: aria-disabled, the reason is the
 *   caller's line) · loading (the pressed one dims and is busy; "Find something else" spins) · error (the caller's
 *   error line under the strip) · success (silent: the frame moves into the pick's place) · empty (emptyAction)
 * layout: the frames wrap by default; `overflow="scroll"` keeps them on one line at their size and scrolls the
 *   strip inside its own box when they don't fit (a thin bar; focus, by Tab or a grid's arrows, brings its frame
 *   into view)
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
  /**
   * With no room for every frame: 'wrap' (default) puts them on more lines; 'scroll' keeps one line of full-size
   * frames that scrolls inside the strip, so the strip never grows past the room its parent gives it.
   */
  overflow?: 'wrap' | 'scroll';
  className?: string;
}

/**
 * Brings the focused frame into the strip's own box, the least distance needed, so the keyboard reaches a frame
 * scrolled out of sight. Only the strip moves: nothing it sits in scrolls.
 */
function revealIn(strip: HTMLElement, item: Element): void {
  const style = getComputedStyle(strip);
  const inner = item.getBoundingClientRect();
  const outer = strip.getBoundingClientRect();
  const left = outer.left + parseFloat(style.paddingLeft);
  const right = outer.right - parseFloat(style.paddingRight);
  if (inner.left < left) strip.scrollLeft -= left - inner.left;
  else if (inner.right > right) strip.scrollLeft += inner.right - right;
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
  overflow = 'wrap',
  className,
}: AlternatesStripProps) {
  const { t } = useLingui();
  return (
    <div
      role="group"
      aria-label={label ?? t`Other shots`}
      data-slot="alternates"
      data-overflow={overflow}
      // Meant to scroll sideways: the text-fit checks leave it out (e2e/inspect.ts).
      data-scroll-x={overflow === 'scroll' ? '' : undefined}
      onFocus={overflow === 'scroll' ? (event) => revealIn(event.currentTarget, event.target) : undefined}
      className={cn(
        'flex items-end gap-2',
        // One line that scrolls: the frames keep their shape; the padding (taken back by the margin) is the room a
        // focus ring needs inside a box that clips. Positioned, so the frames' screen-reader names scroll and clip
        // with the strip instead of widening the column it sits in.
        overflow === 'scroll'
          ? 'relative -m-1 scrollbar-thin min-w-0 overflow-x-auto overscroll-x-contain p-1 [&>*]:shrink-0'
          : 'flex-wrap',
        className,
      )}
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
