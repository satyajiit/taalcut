// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The languages the person speaks, in the jobs process (LIB1-LANG): the prior for spoken-language detection, and
 * whether this Mac wants the Indian-language identifier (`anuvani-lid`, 471 MB).
 *
 * - The identifier is wanted when the app's language or the person's languages include an Indian language
 *   (core's `needsIndianIdentifier`; until the person answers, their languages are the app's language and English).
 *   jobs-root.ts reads the same rule, so the component manager downloads it only then, as one of the downloads the
 *   person sees.
 * - Installed but no longer wanted (the person's languages changed): it is never deleted, only not used; detection
 *   stops at Whisper with its floor.
 * Both are read per job, so a change in Settings reaches the next clip.
 */
import { createIndicLid, INDIC_LID, type AudioIndexJobDeps, type IndicLid } from '@taalcut/audio';
import {
  LOCALE_SETTING,
  needsIndianIdentifier,
  resolveLocale,
  SPOKEN_LANGUAGES_SETTING,
  spokenLanguagesOrDefault,
  type ComputeFallbackEvent,
  type SettingsStore,
  type SpokenLanguage,
} from '@taalcut/core';
import type { ComponentManager } from '@taalcut/jobs';

/** The app's language: the one chosen in Settings, else the Mac's (as main resolves it). */
export async function appLanguage(settings: Pick<SettingsStore, 'get'>): Promise<string> {
  const stored = await settings.get(LOCALE_SETTING);
  const preference = stored.ok ? stored.value : 'system';
  if (preference !== 'system') return preference;
  return resolveLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
}

export interface SpokenLanguagesNow {
  readonly spoken: SpokenLanguage[];
  readonly wantsIdentifier: boolean;
}

export async function spokenLanguagesNow(settings: Pick<SettingsStore, 'get'>): Promise<SpokenLanguagesNow> {
  const [stored, app] = await Promise.all([settings.get(SPOKEN_LANGUAGES_SETTING), appLanguage(settings)]);
  const languages = stored.ok ? stored.value : null;
  return {
    spoken: spokenLanguagesOrDefault(languages, app),
    wantsIdentifier: needsIndianIdentifier(languages, app),
  };
}

/** Whether this Mac fetches the component: the identifier only when wanted; everything else as before. */
export function wantedComponent(id: string, now: Pick<SpokenLanguagesNow, 'wantsIdentifier'>): boolean {
  return id !== INDIC_LID.component || now.wantsIdentifier;
}

/** The identifier, one per installed model folder, made on first use. */
function identifiers(onFallback: (event: ComputeFallbackEvent) => void) {
  const made = new Map<string, IndicLid>();
  return (modelDir: string) => {
    let lid = made.get(modelDir);
    if (!lid) {
      lid = createIndicLid({ modelDir, onComputeFallback: onFallback });
      made.set(modelDir, lid);
    }
    return lid;
  };
}

/** What the audio jobs add for the spoken language, read per job: the prior, and the identifier when wanted. */
export function spokenLanguageDeps(
  settings: Pick<SettingsStore, 'get'>,
  components: () => ComponentManager,
  onFallback: (event: ComputeFallbackEvent) => void,
): () => Promise<Pick<AudioIndexJobDeps, 'indicLid' | 'spokenLanguages'>> {
  const identifier = identifiers(onFallback);
  return async () => {
    const now = await spokenLanguagesNow(settings);
    const installed = now.wantsIdentifier ? await components().get(INDIC_LID.component) : undefined;
    return {
      spokenLanguages: async () => (await spokenLanguagesNow(settings)).spoken,
      ...(installed ? { indicLid: identifier(installed.path) } : {}),
    };
  };
}
