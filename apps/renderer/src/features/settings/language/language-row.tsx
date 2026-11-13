// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: settings, a language row · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (a ChoiceRow: the kit's Radio, its words the hit area)
 * Automatic with what it means here, or a language named in itself with `lang` set; a neutral "Draft
 *   translation" chip on one a native speaker hasn't signed off; a spinner while it's being chosen.
 * states: the ChoiceRow's (default · hover · focus · active · checked with the selected wash · disabled) · loading
 *   (the row spins) · error/success (the section's)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AppLocale, LocalePreference } from '@taalcut/core';
import { Chip } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { localeStatus } from '../../../i18n/locale-status';
import { LANGUAGE_NAMES } from '../../../i18n/use-locale';
import { ChoiceRow } from '../radio-row';

/** Automatic says what it means on this Mac; a language is named in itself. */
function LanguageLabel({ preference, system }: { preference: LocalePreference; system: AppLocale }) {
  const { t } = useLingui();
  return preference === 'system' ? (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span>{t`Automatic`}</span>{' '}
      <span className="type-meta text-ink-2">
        ·{' '}
        <span lang={system} translate="no">
          {LANGUAGE_NAMES[system]}
        </span>
      </span>
    </span>
  ) : (
    <span lang={preference} translate="no">
      {LANGUAGE_NAMES[preference]}
    </span>
  );
}

export function LanguageRow({
  preference,
  system,
  pending,
}: {
  preference: LocalePreference;
  /** What Automatic means on this Mac. */
  system: AppLocale;
  /** This row is being chosen. */
  pending: boolean;
}) {
  const draft = localeStatus(preference === 'system' ? system : preference) !== 'signed-off';
  return (
    <ChoiceRow
      value={preference}
      label={<LanguageLabel preference={preference} system={system} />}
      trailing={
        draft || pending ? (
          <>
            {draft ? (
              <Chip tone="neutral">
                <Trans>Draft translation</Trans>
              </Chip>
            ) : null}
            {pending ? (
              <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />
            ) : null}
          </>
        ) : null
      }
    />
  );
}
