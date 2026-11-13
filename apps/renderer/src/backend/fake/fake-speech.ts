// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (a product name, ids, a version), never UI copy */

/**
 * The languages you speak, as the fake serves them (LIB1-LANG): core's own `settings.setSpokenLanguages` on the
 * fake's bus, and `speech.spokenLanguages` reading what it stored (null until answered: the app's language plus
 * English). As the jobs process does, the download wants the Indian-language identifier only while those languages,
 * or the app's, include an Indian one (`wanted`); one already here stays when they no longer do.
 */
import {
  appContract,
  createSpokenLanguageCommands,
  implementContract,
  needsIndianIdentifier,
  SPOKEN_LANGUAGES_SETTING,
  type AnyCommand,
  type SettingsStore,
  type SpokenLanguage,
} from '@taalcut/core';
import type { FakePart } from './fake-downloads-data';

const MB = 1000 ** 2;

/** The component as the pending manifest lists it (tools/components/manifest.anuvani.provisional.json). */
export const FAKE_IDENTIFIER: FakePart = {
  id: 'anuvani-lid',
  name: 'Language identifier for Odia and other Indian languages',
  version: '3b9caa41-npu-15s',
  licence: 'Apache-2.0',
  sizeBytes: 436.99 * MB,
  unpackedBytes: 471.33 * MB,
  job: 'speech',
  usedBy: ['speech'],
  needs: ['onnxruntime'],
};

/** A part the person's choices want, and whether they did when the page opened (a finished first run has it). */
export interface FakeWanted {
  readonly part: FakePart;
  readonly fromStart: boolean;
}

/**
 * The download's set with the wanted parts in (`join` makes a joining one's state) and a part no longer wanted out,
 * unless it is here or on its way: an installed one is never deleted. `fixed`: in the set whatever was chosen.
 */
export function withWanted<S extends { readonly part: FakePart; readonly status: string }>(
  parts: readonly S[],
  wanted: readonly FakeWanted[],
  rules: { readonly fixed: (part: FakePart) => boolean; readonly join: (wanted: FakeWanted) => S },
): S[] {
  const joining = wanted.filter((one) => !parts.some((each) => each.part.id === one.part.id)).map(rules.join);
  return [...parts, ...joining].filter(
    (each) =>
      rules.fixed(each.part) ||
      wanted.some((one) => one.part === each.part) ||
      each.status === 'installed' ||
      each.status === 'downloading',
  );
}

export interface FakeSpeechOptions {
  /** Already answered, as a person who chose these before the page opened. */
  readonly languages?: readonly SpokenLanguage[];
}

export interface FakeSpeech {
  readonly commands: AnyCommand[];
  readonly router: { readonly speech: ReturnType<typeof speechRouter> };
  /** The parts the person's languages ask for now (the download takes them in, as the jobs process re-plans). */
  wanted(): readonly FakeWanted[];
  /** As stored; null until answered. */
  languages(): readonly SpokenLanguage[] | null;
}

function speechRouter(read: () => readonly SpokenLanguage[] | null) {
  const os = implementContract(appContract.speech);
  return os.router({
    spokenLanguages: os.spokenLanguages.handler(() => {
      const languages = read();
      return { languages: languages ? [...languages] : null };
    }),
  });
}

export function createFakeSpeech(
  deps: { readonly settings: SettingsStore; readonly appLanguage: () => string },
  options: FakeSpeechOptions = {},
): FakeSpeech {
  // Kept here too, so the download's plan can read it at once (the store answers later).
  let stored: SpokenLanguage[] | null = options.languages ? [...options.languages] : null;
  if (stored) void deps.settings.set(SPOKEN_LANGUAGES_SETTING, stored);
  const atStart = needsIndianIdentifier(stored, deps.appLanguage());
  const real = createSpokenLanguageCommands({ settings: deps.settings }).setSpokenLanguages as AnyCommand;
  const command: AnyCommand = {
    ...real,
    handle: async (payload, context) => {
      const outcome = await real.handle(payload, context);
      if (outcome.ok) stored = (outcome.value.result as { languages: SpokenLanguage[] | null }).languages;
      return outcome;
    },
  };
  return {
    commands: [command],
    router: { speech: speechRouter(() => stored) },
    wanted: () =>
      needsIndianIdentifier(stored, deps.appLanguage())
        ? [{ part: FAKE_IDENTIFIER, fromStart: atStart }]
        : [],
    languages: () => stored,
  };
}
