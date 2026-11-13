// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A limit in plain words (G8): what is limited ("ChatGPT plan is busy.", "Your OpenAI key is out of credit."),
 * when it resets (relative under an hour, else the time, both from Intl in a <time>), and what waits on it.
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { UsageLimit } from '@taalcut/core';
import { SUBSCRIPTION_NAMES } from '../providers';
import { providerLabel } from './usage-words';

const HOUR = 3_600_000;

/** The plan's name for a subscription ('ChatGPT', 'Claude'), else the provider's. */
function limitedName(i18n: I18n, limit: UsageLimit): string {
  const plan = SUBSCRIPTION_NAMES[limit.provider];
  if (limit.kind === 'plan' && plan) return i18n._(plan);
  return providerLabel(i18n, limit.provider, false) ?? limit.provider;
}

/** The first sentence: what is limited. */
export function limitHeadline(i18n: I18n, limit: UsageLimit): string {
  const name = limitedName(i18n, limit);
  switch (limit.kind) {
    case 'plan':
      return i18n._(msg`${name} plan is busy.`);
    case 'rate':
      return i18n._(msg`${name} is busy.`);
    case 'quota':
      return i18n._(msg`Your ${name} key is out of credit.`);
  }
}

/** When it resets: "Resets in 38 minutes.", "Resets around 3:40 PM.", or that Taalcut keeps trying. */
export function ResetLine({ limit, now }: { limit: UsageLimit; now: number }) {
  const { i18n } = useLingui();
  if (limit.kind === 'quota') return <Trans>It stays this way until credit is added.</Trans>;
  if (limit.resetsAt === null)
    return <Trans>No reset time was given. Taalcut keeps trying every few minutes.</Trans>;
  const iso = new Date(limit.resetsAt).toISOString();
  const left = limit.resetsAt - now;
  if (left < HOUR) {
    const minutes = Math.max(1, Math.round(left / 60_000));
    const when = new Intl.RelativeTimeFormat(i18n.locale === 'en-XA' ? 'en' : i18n.locale, {
      numeric: 'auto',
    }).format(minutes, 'minute');
    return (
      <Trans>
        Resets{' '}
        <time dateTime={iso} className="font-sans">
          {when}
        </time>
        .
      </Trans>
    );
  }
  const at = i18n.date(new Date(limit.resetsAt), { timeStyle: 'short' });
  return (
    <Trans>
      Resets around{' '}
      <time dateTime={iso} className="font-sans">
        {at}
      </time>
      .
    </Trans>
  );
}

/** What is waiting on it right now, in one short line (none: nothing is held up). */
export function WaitingLine({ limit }: { limit: UsageLimit }) {
  const waiting = new Set(limit.waiting);
  if (waiting.size === 0) return <Trans>Nothing is waiting on it right now.</Trans>;
  if (waiting.has('export')) return <Trans>An export is waiting. Nothing is lost.</Trans>;
  if (waiting.has('run') && waiting.has('background'))
    return <Trans>A chat and background work are waiting.</Trans>;
  if (waiting.has('run')) return <Trans>A chat is waiting. It carries on by itself.</Trans>;
  return <Trans>Background work is waiting. It carries on by itself.</Trans>;
}
