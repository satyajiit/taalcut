// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the beta terms (UX4 type roles) · genre: atmospheric studio app · system: DESIGN.md v0.3 + design-type.md
 * three plain lines (P3-B14), the terms' version, and "Read the beta terms": counsel's full text on the website, in
 *   the app's language, opened in the browser. Shown on first run's beta step and in Settings › About before
 *   switching to the beta channel. Agreeing is the agent's acknowledgement (BETA_TERMS), which updates.setChannel
 *   checks.
 * states: n/a (text and one link: default · hover (thicker underline) · focus (base ring) · active)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { BETA_TERMS, callRpc, type AppLocale, type Result } from '@taalcut/core';
import type { Backend } from '../../backend/contract';
import { isAppLocale } from '../../i18n/locales';
import { BrowserLink } from '../../chat/external-link';

/** The website's language segments (website/src/i18n/locales.ts): English at the root. */
const SEGMENT: Readonly<Record<AppLocale, string>> = { en: '', hi: 'hi/', es: 'es/', 'pt-BR': 'pt-br/' };

/** Counsel's full beta terms, on the website, in the app's language. */
export function betaTermsUrl(locale: string): string {
  return `https://taalcut.app/${isAppLocale(locale) ? SEGMENT[locale] : ''}beta-terms/`;
}

/** Records the agreement where updates.setChannel looks for it (the agent's acknowledgements). */
export function agreeToBetaTerms(backend: Backend): Promise<Result<{ acknowledgedAt: number }>> {
  return callRpc(
    backend.acknowledgements.record({
      featureId: BETA_TERMS.featureId,
      termsVersion: BETA_TERMS.termsVersion,
    }),
  );
}

export function BetaTermsLines() {
  const { t, i18n } = useLingui();
  const draft = BETA_TERMS.termsVersion === 'draft';
  const [year = 2026, month = 1, day = 1] = BETA_TERMS.termsVersion.split('-').map(Number);
  const version = draft ? null : i18n.date(new Date(year, month - 1, day), { dateStyle: 'medium' });
  return (
    <section aria-label={t`The beta terms`} className="flex flex-col gap-3">
      <ul className="m-0 flex max-w-prose list-disc flex-col gap-2 ps-5 type-prose text-ink marker:text-ink-3">
        <li>
          {t({
            id: 'onboarding.beta.line1',
            message: 'Things can still break. Your clips stay on this Mac.',
          })}
        </li>
        <li>
          {t({ id: 'onboarding.beta.line2', message: 'Updates come often, and install when you restart.' })}
        </li>
        <li>
          {t({
            id: 'onboarding.beta.line3',
            message: 'Sharing usage counts and crash reports is up to you. Both start off.',
          })}
        </li>
      </ul>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 type-body text-ink-2">
        {version ? (
          <span>
            <Trans>Beta terms of {version}.</Trans>
          </span>
        ) : (
          <span>
            <Trans>Draft beta terms.</Trans>
          </span>
        )}
        <BrowserLink href={betaTermsUrl(i18n.locale)} size="inherit">
          {t({ id: 'onboarding.beta.readTerms', message: 'Read the beta terms' })}
        </BrowserLink>
      </p>
    </section>
  );
}
