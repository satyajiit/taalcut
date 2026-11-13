// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: share lists (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · two short lists side by side (stacked when narrow): "Shared" (what the document holds)
 *   and "Not shared" (always shown: your video, the reel, the words on screen, your name), a check and a dash as
 *   their marks, ink only
 * states: n/a (static lists; "The look" joins Shared when Include the look is on)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

function List({ title, items, mark }: { title: string; items: readonly string[]; mark: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
      <h3 className="m-0 text-sm font-semibold text-ink">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-ink-2">
            <span aria-hidden className="mt-0.5 inline-flex shrink-0 text-ink-3 [&_svg]:size-3.5">
              {mark}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShareLists({
  slots,
  includeStyle,
}: {
  readonly slots: number;
  readonly includeStyle: boolean;
}) {
  const { t } = useLingui();
  const shared = [
    t`${plural(slots, { one: '# slot and its length', other: '# slots and their lengths' })}`,
    t`What each slot asks for, in your words`,
    t`The beats and the pacing`,
    t`Where text goes and how long it is`,
    ...(includeStyle ? [t`The look: colours, fonts and caption style`] : []),
  ];
  const notShared = [
    t`Your video and its frames`,
    t`The reel and its link`,
    t`The words on screen`,
    t`Your name and account`,
  ];
  return (
    <div data-slot="share-lists" className="flex flex-wrap gap-x-6 gap-y-4">
      <List title={t`Shared`} items={shared} mark={<Check />} />
      <List title={t`Not shared`} items={notShared} mark={<Minus />} />
    </div>
  );
}
