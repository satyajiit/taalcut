// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { registerBones as registerCaptured } from 'boneyard-js';
import { Skeleton as Boneyard } from 'boneyard-js/react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '#lib/cn';
import { fillEmptyBreakpoints } from './fill-breakpoints';

/** The skeletons that have captured bones (src/bones/registry.ts registers them at start-up). */
const captured = new Set<string>();

/**
 * Registers captured bones by skeleton name (called by the generated registry). A width captured empty borrows a
 * neighbour's bones (fill-breakpoints.ts).
 */
export function registerBones(map: Parameters<typeof registerCaptured>[0]): void {
  for (const name of Object.keys(map)) captured.add(name);
  registerCaptured(
    Object.fromEntries(Object.entries(map).map(([name, bones]) => [name, fillEmptyBreakpoints(bones)])),
  );
}

/**
 * What a capture leaves out: screen-reader-only text, and what a closed <details> holds. Chrome lays a closed
 * details' content out unseen (content-visibility, not display: none), so without this a folded plan's steps came
 * out as bones over the lines under it.
 */
const SNAPSHOT = { excludeSelectors: ['.sr-only', 'details:not([open])>:not(summary)'] };

export interface SkeletonProps {
  /**
   * Names the capture. `pnpm --filter @taalcut/renderer bones:capture` snapshots
   * the element under this name and the generated registry supplies its bones.
   */
  name: string;
  /** True while the data is on its way. */
  loading: boolean;
  /** The real content. While loading with captured bones it renders, hidden, under them. */
  children: ReactNode;
  /**
   * Stand-in content rendered only in the capture browser, where there is no
   * preload bridge and no data. Give it the shape of a typical result.
   */
  fixture?: ReactNode;
  /** Shown while loading when no bones were captured. Default: shimmering text lines. */
  fallback?: ReactNode;
  className?: string;
}

/**
 * Taalcut's skeleton (PRD R32): boneyard-js bones captured from the real layout,
 * drawn with tokens. Bones are solid blocks whose pulse comes from the
 * `tc-bone` class: boneyard's own pulse and shimmer render an inline <style>
 * element, which the CSP blocks. The colour is a token, so it follows the
 * theme without boneyard's `.dark` detection.
 */
export function Skeleton({ name, loading, children, fixture, fallback, className }: SkeletonProps) {
  return (
    <Boneyard
      name={name}
      loading={loading}
      animate="solid"
      color="var(--color-hover)"
      darkColor="var(--color-hover)"
      boneClass="tc-bone"
      select="viewport"
      // Screen-reader-only text ("You:") is 1 px: a bone for it is a stray dot.
      snapshotConfig={SNAPSHOT}
      className={cn('tc-skeleton min-w-0 max-w-full', className)}
      fixture={fixture}
      // With captured bones, no stand-in: boneyard sizes the bones to the first height it
      // measures, and the stand-in lines' 74 px would squash 455 px of bones to a sixth.
      fallback={captured.has(name) ? null : (fallback ?? <SkeletonLines />)}
    >
      {children}
    </Boneyard>
  );
}

export interface SkeletonLinesProps {
  /** How many lines. */
  lines?: number;
  className?: string;
}

/** The generic stand-in: a few text-height bones and a screen-reader "Loading". */
export function SkeletonLines({ lines = 3, className }: SkeletonLinesProps) {
  const { t } = useLingui();
  return (
    <div data-slot="skeleton-lines" className={cn('flex flex-col gap-3 py-1', className)}>
      <span className="sr-only" role="status">
        {t`Loading`}
      </span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className="tc-bone block h-3.5 rounded-sm bg-hover"
          // Ragged right edge, like real text: 92%, 78%, 64%, then repeat.
          style={{ width: `${92 - (index % 3) * 14}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}
