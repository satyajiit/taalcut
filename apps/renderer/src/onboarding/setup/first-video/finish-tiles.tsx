// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step's ways to start as tiles (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6 +
 *   _orch/ux4/specs/design-onb.md
 * the three ways side by side as Your videos' choice tiles (ChoiceTile: glyph, name, line); the open one's panel
 *   takes a full-width row right after the tiles, so focus goes tile → panel. One column when the step is narrow.
 * motion: Arrival for the opened panel (8 px rise and fade; reduced motion: fade); a tile gives 1 % pressed.
 * states (tiles): ChoiceTile's · disabled (a start in flight)
 */
import { Arrival } from '@taalcut/ui';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { ChoiceTile } from '../sources/source-tiles';

export type FinishWay = 'reference' | 'template' | 'describe';

export interface FinishTile {
  readonly id: FinishWay;
  readonly icon: ReactNode;
  readonly title: string;
  readonly line: ReactNode;
  readonly panel: ReactNode;
}

export function FinishTiles({
  label,
  ways,
  open,
  onOpen,
  disabled,
}: {
  label: string;
  ways: readonly FinishTile[];
  open: FinishWay | null;
  onOpen: (way: FinishWay | null) => void;
  disabled: boolean;
}) {
  const base = useId();
  // Only a panel the person opened arrives; one open from a resume is simply there.
  const [opened, setOpened] = useState(false);
  return (
    <div className="@container">
      <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-3 p-0 @xl:grid-cols-3">
        {ways.map((way) => {
          const isOpen = open === way.id;
          return (
            <Fragment key={way.id}>
              <li data-path={way.id} className="flex">
                <ChoiceTile
                  icon={way.icon}
                  title={way.title}
                  line={way.line}
                  open={isOpen}
                  panelId={`${base}-${way.id}`}
                  disabled={disabled}
                  onToggle={() => {
                    setOpened(true);
                    onOpen(isOpen ? null : way.id);
                  }}
                />
              </li>
            </Fragment>
          );
        })}
        {ways.map((way) =>
          open === way.id ? (
            <li key={`${way.id}-panel`} data-panel-for={way.id} className="col-span-full min-w-0 pt-5">
              <Arrival animate={opened}>
                <div id={`${base}-${way.id}`} role="region" aria-label={way.title}>
                  {way.panel}
                </div>
              </Arrival>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}
