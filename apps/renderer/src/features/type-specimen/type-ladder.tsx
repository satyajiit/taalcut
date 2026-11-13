// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * The type roles as they are: each role's words in English and Hindi, and the size, leading, weight and tracking
 * the browser computes for them, read from the page, so the ladder can't drift from roles.css.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { useLayoutEffect, useRef, useState } from 'react';
import { ROLE_WORDS, ROLES, type Role } from './samples';

interface Computed {
  size: number;
  leading: number;
  weight: number;
  tracking: number;
}

function measure(element: HTMLElement | null): Computed | null {
  if (!element) return null;
  const style = getComputedStyle(element);
  const size = Number.parseFloat(style.fontSize);
  const spacing = Number.parseFloat(style.letterSpacing);
  return {
    size,
    leading: Number.parseFloat(style.lineHeight),
    weight: Number.parseFloat(style.fontWeight),
    tracking: Number.isNaN(spacing) ? 0 : spacing / size,
  };
}

function Spec({ value }: { value: Computed | null }) {
  const { i18n } = useLingui();
  if (!value) return null;
  const size = i18n.number(value.size);
  const leading = i18n.number(value.leading);
  const weight = i18n.number(value.weight);
  const tracking = i18n.number(value.tracking, { maximumFractionDigits: 3, signDisplay: 'exceptZero' });
  return (
    <Trans>
      {size} px on {leading}, weight {weight}, tracking {tracking} em
    </Trans>
  );
}

function RoleRow({ role }: { role: Role }) {
  const english = useRef<HTMLSpanElement>(null);
  const hindi = useRef<HTMLSpanElement>(null);
  const [specs, setSpecs] = useState<{ en: Computed | null; hi: Computed | null }>({ en: null, hi: null });
  useLayoutEffect(() => {
    setSpecs({ en: measure(english.current), hi: measure(hindi.current) });
  }, []);
  const words = ROLE_WORDS[role];
  const hindiDiffers =
    specs.en && specs.hi && (specs.en.size !== specs.hi.size || specs.en.leading !== specs.hi.leading);
  return (
    <li className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 py-3 @3xl:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
      <code translate="no" className="type-meta text-ink-2">
        {role}
      </code>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
        <span ref={english} lang="en" translate="no" className={`${role} text-ink`}>
          {words.en}
        </span>
        <span ref={hindi} lang="hi" translate="no" className={`${role} text-ink`}>
          {words.hi}
        </span>
      </span>
      <span className="type-meta flex flex-col text-ink-2">
        <span>
          <Spec value={specs.en} />
        </span>
        {hindiDiffers ? (
          <span>
            <Trans>
              In Hindi: <Spec value={specs.hi} />
            </Trans>
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** Every role, largest first, as the browser computes it. */
export function TypeLadder() {
  return (
    <ul className="@container m-0 flex list-none flex-col divide-y divide-rule-subtle p-0">
      {ROLES.map((role) => (
        <RoleRow key={role} role={role} />
      ))}
    </ul>
  );
}
