// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The languages you speak (LIB1-LANG), for Settings › General and first run: what is stored (null until answered,
 * which means the app's language plus English), the command that changes it (`settings.setSpokenLanguages`, so ⌘Z
 * undoes it and every window follows `command.changed`), and the Indian-language identifier those languages may
 * need. Adding the first Indian language starts its download, the one download of everything this Mac needs, with
 * the identifier first: it shows in the window bar's indicator and in Settings › Models with its name and size,
 * and it obeys a pause (a paused download isn't restarted from here), the disk-space check and a lost connection.
 * Taking the language out again leaves an installed identifier where it is; detection just stops using it.
 */
import {
  callRpc,
  COMPONENT_COMMANDS,
  needsIndianIdentifier,
  SPEECH_COMMANDS,
  spokenLanguagesOrDefault,
  SPOKEN_LANGUAGES_MAX,
  type Component,
  type SpokenLanguage,
  type TaalcutError,
} from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { useLocaleState } from '../../../i18n/use-locale';
import { named } from '../../downloads/use-download-actions';
import { useDownloads } from '../../downloads/downloads-store';

/** The Indian-language identifier's component id (tools/components/manifest.anuvani.provisional.json). */
export const IDENTIFIER_ID = 'anuvani-lid';

export function useSpokenLanguages() {
  const backend = useBackend();
  const { run } = useCommand({ toast: false });
  const stored = useRpcQuery((signal) => backend.speech.spokenLanguages(undefined, { signal }), [backend]);
  const components = useRpcQuery((signal) => backend.system.components(undefined, { signal }), [backend]);
  const { downloads } = useDownloads();
  const locale = useLocaleState();
  const [error, setError] = useState<TaalcutError | null>(null);
  const [pending, setPending] = useState(false);
  const { reload } = stored;
  const reloadComponents = components.reload;
  useBackendEvents(['command.changed'], (event) => {
    if (event.payload.name === SPEECH_COMMANDS.setSpokenLanguages) {
      reload();
      reloadComponents();
    }
  });

  const appLanguage = locale.data?.resolved ?? 'en';
  const answered = stored.data?.languages ?? null;
  const languages = spokenLanguagesOrDefault(answered, appLanguage);
  const needed = needsIndianIdentifier(answered, appLanguage);
  // The live download's copy first (its progress), else the list's (installed, or not in this build at all).
  const identifier: Component | undefined =
    downloads?.components.find((each) => each.id === IDENTIFIER_ID) ??
    components.data?.find((each) => each.id === IDENTIFIER_ID);

  /** Starts the identifier's download when these languages newly need it and the download isn't paused. */
  const fetchIdentifier = useCallback(async () => {
    const listed = await callRpc(backend.system.components(undefined));
    const found = listed.ok ? listed.value.find((each) => each.id === IDENTIFIER_ID) : undefined;
    // Not in this build's components (not hosted yet): detection carries on without it.
    if (!found || found.status === 'installed' || downloads?.state === 'paused') return;
    if (found.status === 'downloading' || found.status === 'queued') return;
    const started = await run({ name: COMPONENT_COMMANDS.download, payload: { first: [IDENTIFIER_ID] } });
    if (!started.ok) setError(named(started.error, listed.ok ? listed.value : null));
  }, [backend, run, downloads?.state]);

  const save = useCallback(
    async (next: readonly SpokenLanguage[] | null) => {
      setError(null);
      setPending(true);
      const before = needsIndianIdentifier(answered, appLanguage);
      const result = await run({
        name: SPEECH_COMMANDS.setSpokenLanguages,
        payload: { languages: next ? [...next] : null },
      });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      reload();
      if (!before && needsIndianIdentifier(next, appLanguage)) await fetchIdentifier();
      reloadComponents();
      return true;
    },
    [answered, appLanguage, run, fetchIdentifier, reload, reloadComponents],
  );

  return {
    /** The first load (stored and the app's language). */
    loading: (stored.status !== 'error' && !stored.data) || !locale.data,
    loadError: stored.status === 'error' && !stored.data ? stored.error : null,
    /** Null until the person answers: `languages` is then the app's language plus English. */
    answered,
    languages,
    full: languages.length >= SPOKEN_LANGUAGES_MAX,
    add: (language: SpokenLanguage) => save([...languages, language]),
    remove: (language: SpokenLanguage) => save(languages.filter((each) => each !== language)),
    /** Keeps what is shown, so the question counts as answered (first run's "These are right"). */
    confirm: () => save(languages),
    pending,
    error,
    /** These languages, or the app's, need the identifier. */
    needed,
    /** The identifier as this Mac has it: absent when this build doesn't list it. */
    identifier,
    /** Starts its download again (it was never started, or it failed). */
    download: fetchIdentifier,
    downloadsPaused: downloads?.state === 'paused',
  };
}
