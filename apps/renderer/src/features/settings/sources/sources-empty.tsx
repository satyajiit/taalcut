// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Sources' empty folder list (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6 +
 *   UX4 (the kit's EmptyState, Kaatu as companion)
 * the shape of what the list will hold (DESIGN "Empty states"): three still ghost rows in the list's own frame (a
 *   folder mark and two lines each, `hover` blocks, no pulse: nothing is loading), then Kaatu beside one plain line
 *   and the one action that fills it, Add folder. No icon tile, no dashed box.
 */
import { Trans } from '@lingui/react/macro';
import { CONCEPT_ICONS, EmptyState, Glyph } from '@taalcut/ui';
import type { ReactNode } from 'react';

const GHOSTS = [
  ['34%', '58%'],
  ['26%', '50%'],
  ['30%', '44%'],
] as const;

/** The empty folder list: its still shape, Kaatu and the words, and `action` (Add folder). */
export function SourcesEmpty({ action }: { action: ReactNode }) {
  return (
    <div data-slot="sources-empty">
      <EmptyState
        titleAs="h3"
        title={<Trans>No folders yet</Trans>}
        description={
          <Trans>
            Add the folder your videos are in. Taalcut reads each clip where it is and never moves it.
          </Trans>
        }
        action={action}
      >
        <ul
          aria-hidden
          className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-rule-subtle p-0"
        >
          {GHOSTS.map(([name, path]) => (
            <li
              key={name}
              className="flex min-h-12 items-center gap-3 border-t border-rule-subtle px-3 py-2 first:border-t-0"
            >
              <span className="flex size-8 shrink-0 items-center justify-center text-ink-disabled">
                <Glyph icon={CONCEPT_ICONS.folder} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                <span className="block h-3 rounded-sm bg-hover" style={{ width: name }} />
                <span className="block h-2.5 rounded-sm bg-hover" style={{ width: path }} />
              </div>
            </li>
          ))}
        </ul>
      </EmptyState>
    </div>
  );
}
