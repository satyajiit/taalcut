// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: welcome, language · genre: atmospheric studio app (brand moment, quiet) · system: DESIGN.md v0.3
 * one compact line under the welcome's words: "Language" then the four languages, each named in itself (`lang`
 *   set), with a middot between. Native radios under the words, so arrows move and choose; the chosen one is ink
 *   600 with a marigold underline (a mark, not a fill: Get started is the screen's one marigold fill).
 * states: default (ink-2) · hover (ink) · focus (base ring on the word) · active (pressed: ink) · checked
 *   (ink 600, marigold underline) · disabled (before the state loads: the line waits, nothing to press) · loading
 *   (the chosen word holds while the command runs; the group is aria-busy) · error (ErrorLine under the line) ·
 *   success (the screen's words change at once; announced politely in the new language)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { APP_LOCALES } from '@taalcut/core';
import { cn, ErrorLine } from '@taalcut/ui';
import { Fragment, useId } from 'react';
import { LanguageBetaNotice } from '../features/settings/language/language-notice';
import { localeStatus } from '../i18n/locale-status';
import { LANGUAGE_NAMES } from '../i18n/use-locale';
import { useLanguageChoice } from '../features/settings/language/use-language-choice';

/**
 * The welcome's language choice starts in English for this beta. Contributors can explicitly select a draft
 * translation; that choice switches every window and becomes the app's saved language.
 */
export function WelcomeLanguage() {
  const { t } = useLingui();
  const choice = useLanguageChoice();
  const name = useId();
  const labelId = useId();
  const shown = choice.current === 'system' ? choice.system : choice.current;
  const changedTo = choice.changedTo ? LANGUAGE_NAMES[choice.changedTo] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={labelId} className="text-sm font-medium text-ink-3">
          {t({ id: 'onboarding.welcome.language', message: 'Language' })}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-busy={choice.pending !== null || undefined}
          className="flex flex-wrap items-center gap-x-1 text-base"
        >
          {APP_LOCALES.map((locale, i) => {
            const id = `${name}-${locale}`;
            const checked = shown === locale;
            return (
              <Fragment key={locale}>
                {i > 0 ? (
                  <span aria-hidden className="text-ink-3">
                    ·
                  </span>
                ) : null}
                <label
                  htmlFor={id}
                  data-checked={checked || undefined}
                  className={cn(
                    'relative inline-flex min-h-6 cursor-pointer items-center rounded-sm px-1 py-0.5',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out)',
                    checked
                      ? 'font-semibold text-ink underline decoration-primary-strong decoration-2 underline-offset-4'
                      : 'text-ink-2 hover:text-ink active:text-ink',
                    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name={name}
                    value={locale}
                    checked={checked}
                    disabled={!choice.state.data}
                    onChange={() => void choice.choose(locale)}
                    className="sr-only"
                  />
                  <span lang={locale} translate="no">
                    {LANGUAGE_NAMES[locale]}
                  </span>
                  {localeStatus(locale) !== 'signed-off' ? (
                    <span className="ml-1 text-xs text-ink-3">
                      (<Trans>Draft translation</Trans>)
                    </span>
                  ) : null}
                </label>
              </Fragment>
            );
          })}
        </div>
      </div>
      <LanguageBetaNotice />
      {choice.error ? <ErrorLine error={choice.error} /> : null}
      <p aria-live="polite" className="sr-only">
        {changedTo ? t`Taalcut is now in ${changedTo}.` : ''}
      </p>
      <p className="m-0 text-sm text-ink-3">
        <Trans id="onboarding.welcome.sayIt">
          Say it “<span translate="no">TAHL-cut</span>”
        </Trans>
      </p>
    </div>
  );
}
