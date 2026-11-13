// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  HUB_ERROR_CODES,
  HubInvalid,
  HubLicenceRequired,
  HubNotOwner,
  type TaalcutError,
} from '@taalcut/core';
import { errorMessage } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { HUB_MESSAGES } from '../src/features/templates/hub-messages';
import { activateLocale, i18n } from '../src/i18n/i18n';

const hubError = (code: string): TaalcutError => ({ code, messageKey: `errors.${code}`, retryable: false });

describe('hub error words', () => {
  it('cover every hub code, and nothing else', () => {
    expect(HUB_MESSAGES.map((descriptor) => descriptor.id).sort()).toEqual(
      HUB_ERROR_CODES.map((code) => `errors.${code}`).sort(),
    );
  });

  it('are what the app shows for each, never the generic sentence', async () => {
    await activateLocale('en');
    const generic = errorMessage(i18n, hubError('core.unknown'));
    for (const code of HUB_ERROR_CODES) expect(errorMessage(i18n, hubError(code)), code).not.toBe(generic);
    expect(errorMessage(i18n, HubLicenceRequired())).toBe(
      'Sharing needs your OK to the CC0 licence first. Tick it on the Share card.',
    );
    expect(errorMessage(i18n, HubNotOwner())).toBe(
      'Only the Mac that first shared this template can update it on the hub.',
    );
    expect(errorMessage(i18n, HubInvalid({ problems: 2 }))).toBe(
      'This template has 2 things to fix before it can be shared. The Share card lists them.',
    );
  });
});
