// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A cleanup plan in words (P3-V9): "Remove 14 fillers, shorten 9 pauses, cut 2 retakes and add 3 punch-ins:
 * 0:52 → 0:41", each count with the language's plural rules and the list joined by Intl; the refusals a plan
 * can meet, plainly (the error catalogue has no entries for the cleanup codes yet).
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { CleanupPlan, TaalcutError } from '@taalcut/core';
import { errorMessage } from '../feedback/error-messages';

const intlLocale = (locale: string) => (locale === 'en-XA' ? 'en' : locale);

/** What the plan does, as a list of what goes; null when it does nothing. */
export function cleanupList(i18n: I18n, stats: CleanupPlan['stats']): string | null {
  const parts = [
    stats.fillers > 0
      ? i18n._(msg`${plural(stats.fillers, { one: 'remove # filler', other: 'remove # fillers' })}`)
      : null,
    stats.pauses > 0
      ? i18n._(msg`${plural(stats.pauses, { one: 'shorten # pause', other: 'shorten # pauses' })}`)
      : null,
    stats.retakes > 0
      ? i18n._(msg`${plural(stats.retakes, { one: 'cut # retake', other: 'cut # retakes' })}`)
      : null,
    stats.punchIns > 0
      ? i18n._(msg`${plural(stats.punchIns, { one: 'add # punch-in', other: 'add # punch-ins' })}`)
      : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const locale = intlLocale(i18n.locale);
  // The pseudo-locale has no list words of its own: commas only, so no English shows through.
  const list =
    i18n.locale === 'en-XA'
      ? parts.join(', ')
      : new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
  // The sentence's first letter, wherever it is (a script's marks may come first).
  return list.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
}

/** "Remove 14 fillers, shorten 9 pauses…: 0:52 → 0:41", or that there is nothing to cut. */
export function cleanupSentence(
  i18n: I18n,
  stats: CleanupPlan['stats'],
  before: string,
  after: string,
): string {
  const list = cleanupList(i18n, stats);
  if (!list) return i18n._(msg`Nothing to cut with these switches: the speech is already tight.`);
  return i18n._(msg`${list}: ${before} → ${after}`);
}

/** The cleanup's refusals, said plainly; anything else as the catalogue says it. */
export function cleanupErrorWords(i18n: I18n, error: TaalcutError): string {
  switch (error.code) {
    case 'timeline.cleanup_no_speech':
      return i18n._(msg`No speech found in this video.`);
    case 'timeline.cleanup_stale':
      return i18n._(msg`Your video changed. Check again.`);
    case 'timeline.clip_locked':
      return i18n._(msg`A clip you locked is in the way. Unlock it to clean it up.`);
    default:
      return errorMessage(i18n, error);
  }
}
