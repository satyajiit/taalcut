// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* The families the app ships: what each is for, the scripts it draws, and what it adds to the app. */
import { Trans, useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { formatBytes } from '../shared/format';
import { FAMILIES, type Family } from './families';

function Job({ family }: { family: Family }) {
  switch (family.job) {
    case 'interface':
      return <Trans>Everything you read</Trans>;
    case 'numbers':
      return <Trans>Numbers that change in place</Trans>;
    case 'fallback':
      return <Trans>Greek, and Latin or Cyrillic Onest lacks</Trans>;
    case 'script':
      return <Trans>Fallback, at Onest’s x-height</Trans>;
  }
}

export function FamilyFacts() {
  const { i18n } = useLingui();
  const id = useId();
  const scripts = new Intl.DisplayNames([i18n.locale], { type: 'script' });
  const list = new Intl.ListFormat(i18n.locale, { type: 'conjunction', style: 'narrow' });
  const total = formatBytes(
    i18n,
    FAMILIES.reduce((sum, family) => sum + family.bytes, 0),
  );
  return (
    <section aria-labelledby={id} className="@container flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="type-section text-ink">
          <Trans>The families</Trans>
        </h2>
        <p className="type-body m-0 max-w-prose text-ink-2">
          <Trans>
            All OFL, all inside the app: {total} in all, and a family loads only when its script is on screen.
            Chinese, Japanese and Korean use the system’s own fonts.
          </Trans>
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-rule-subtle p-0">
        {FAMILIES.map((family) => {
          const [min, max] = family.weights;
          const drawn = list.format(family.scripts.map((code) => scripts.of(code) ?? code));
          const size = formatBytes(i18n, family.bytes);
          return (
            <li
              key={family.name}
              className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 py-2 @2xl:grid-cols-[13rem_minmax(0,1fr)_auto]"
            >
              <span translate="no" className="type-label text-ink">
                {family.name}
              </span>
              <span className="type-meta flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
                <span>
                  <Job family={family} />
                </span>
                <span translate="no">{drawn}</span>
                <span>
                  <Trans>
                    Weights {min}–{max}
                  </Trans>
                </span>
              </span>
              <span className="type-data text-end text-ink-2">{size}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
