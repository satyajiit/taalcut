// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choices, folded (success) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · once a way is taken the tiles fold to one quiet line: a success check and the way's name,
 *   then "Or:" and the other ways as text links, so the person can still change their mind
 * states: default · hover (ink, a firmer underline) · focus-visible (the base ring, instant) · active (the browser's
 *   press) · disabled (a run is going: no underline) · loading, error: the unfolded tiles' own · success: this line
 */
import { Trans } from '@lingui/react/macro';
import type { OpeningPath } from '@taalcut/core';
import { CircleCheck } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '#lib/cn';

export interface OpeningFoldedProps {
  marked: OpeningPath;
  paths: readonly OpeningPath[];
  busy: boolean;
  nameOf: (path: OpeningPath) => string;
  /** Unfold and take another way. */
  onOther: (path: OpeningPath) => void;
  className?: string | undefined;
}

/** The way taken, and the others as one line of "Or …". */
export function OpeningFolded({ marked, paths, busy, nameOf, onOther, className }: OpeningFoldedProps) {
  const others = paths.filter((path) => path !== marked);
  return (
    <div data-slot="opening-choices" data-chosen={marked} className={cn('flex flex-col gap-1', className)}>
      <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        <span className="font-medium text-ink">{nameOf(marked)}</span>
      </p>
      {others.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-x-1 ps-6 text-sm text-ink-2">
          <Trans>Or:</Trans>
          {others.map((path, i) => (
            <Fragment key={path}>
              {i > 0 ? <span aria-hidden>·</span> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => onOther(path)}
                className="cursor-pointer rounded-sm px-0.5 text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink hover:decoration-ink-3 disabled:cursor-not-allowed disabled:no-underline"
              >
                {nameOf(path)}
              </button>
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}
