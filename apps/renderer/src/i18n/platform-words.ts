// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every sentence the window shows that names the Mac, with its words on other computers (UX3-MAC): the kit's table
 * and one per area of the app. activateLocale loads each catalogue through them (withPlatformWords), so off a Mac
 * the Mac's ids say "this computer"; describeError and translateKey look keys up in the same list. An area that adds
 * a sentence naming the Mac adds its pair to its table, or lists it in test/platform-words.test.ts as shown on a Mac
 * alone. That test fails on any other.
 */
import { KIT_PLATFORM_WORDS, type PlatformWords } from '@taalcut/ui';
import { DOWNLOADS_PLATFORM_WORDS } from '../features/downloads/downloads-platform-words';
import { LIBRARY_PLATFORM_WORDS } from '../features/library/library-platform-words';
import { MAKE_PLATFORM_WORDS } from '../features/make/make-platform-words';
import { PRIVACY_PLATFORM_WORDS } from '../features/settings/privacy/privacy-platform-words';
import { SETTINGS_PLATFORM_WORDS } from '../features/settings/settings-platform-words';
import { TEMPLATES_PLATFORM_WORDS } from '../features/templates/templates-platform-words';
import { ONBOARDING_PLATFORM_WORDS } from '../onboarding/onboarding-platform-words';

export const PLATFORM_WORDS: readonly PlatformWords[] = [
  ...KIT_PLATFORM_WORDS,
  ...SETTINGS_PLATFORM_WORDS,
  ...PRIVACY_PLATFORM_WORDS,
  ...LIBRARY_PLATFORM_WORDS,
  ...MAKE_PLATFORM_WORDS,
  ...DOWNLOADS_PLATFORM_WORDS,
  ...ONBOARDING_PLATFORM_WORDS,
  ...TEMPLATES_PLATFORM_WORDS,
];
