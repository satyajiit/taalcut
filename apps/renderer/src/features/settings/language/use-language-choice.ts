// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  APP_LOCALES,
  type AppLocale,
  type LocalePreference,
  type LocaleState,
  type TaalcutError,
} from '@taalcut/core';
import { useHostPlatform } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { activateLocale, pseudoOverride, storeLocale } from '../../../i18n/i18n';
import { setLocaleRequest, useLocaleState } from '../../../i18n/use-locale';

/** Every preference the switcher offers, Automatic first. */
export const LANGUAGE_OPTIONS: readonly LocalePreference[] = ['system', ...APP_LOCALES];

/**
 * A choice shown checked before the saved preference says so: while its command runs, then, once it has answered,
 * until `locale.changed` brings a newer saved state than the one in place at the answer (`over`).
 */
type Choice =
  | { readonly preference: LocalePreference; readonly answered: false }
  | {
      readonly preference: LocalePreference;
      readonly answered: true;
      readonly over: LocaleState | undefined;
    };

/**
 * Choosing the app's language (P3-L2): `settings.setLocale` on the bus, so ⌘Z undoes it and every window follows
 * `locale.changed`. The choice shows at once and stays checked until the saved preference catches up: the command's
 * answer can come before `locale.changed`, and the row never goes back to the old language in between. A failure
 * comes back as the error.
 */
export function useLanguageChoice() {
  const state = useLocaleState();
  const command = useCommand({ toast: false });
  const platform = useHostPlatform();
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [changedTo, setChangedTo] = useState<AppLocale | null>(null);

  const data = state.data;
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  // The saved preference is the choice, or a newer saved state came after the answer (an undo, another window).
  useEffect(() => {
    if (!chosen) return;
    if (data?.preference === chosen.preference || (chosen.answered && data !== chosen.over)) setChosen(null);
  }, [chosen, data]);
  // Match main's locale host: automatic selection uses English while it is the one supported language.
  const system: AppLocale = 'en';
  const resolvedFor = (preference: LocalePreference): AppLocale =>
    preference === 'system' ? system : preference;

  const choose = async (preference: LocalePreference) => {
    if (preference === data?.preference) return;
    setChosen({ preference, answered: false });
    setError(null);
    // A developer's pseudo-locale gives way to a language chosen here.
    const overridden = pseudoOverride();
    if (overridden) storeLocale(null);
    const result = await command.run(setLocaleRequest(preference));
    // A later choice made meanwhile is the one that shows.
    const mine = (was: Choice | null) => was?.preference === preference && !was.answered;
    if (!result.ok) {
      setChosen((was) => (mine(was) ? null : was));
      setError(result.error);
      return;
    }
    setChosen((was) => (mine(was) ? { preference, answered: true, over: latest.current } : was));
    const next = resolvedFor(preference);
    if (overridden) await activateLocale(next, platform);
    setChangedTo(next);
  };

  return {
    state,
    /** The preference to show checked: the one being chosen, else the saved one. */
    current: chosen?.preference ?? data?.preference ?? null,
    /** What Automatic means on this Mac. */
    system,
    /** What the app shows now. */
    resolved: data?.resolved ?? null,
    choose,
    pending: command.pending ? (chosen?.preference ?? null) : null,
    error,
    /** Set after a switch, for the polite announcement. */
    changedTo,
  };
}
