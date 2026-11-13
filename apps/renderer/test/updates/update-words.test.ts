// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Main's refusals of a channel file (desktop.update_manifest_*, SB-19) each say their cause in every app language,
// not Settings' generic error line.
import { describe, expect, it } from 'vitest';
import { describeUpdateError } from '../../src/features/updates/update-words';
import { activateLocale, i18n } from '../../src/i18n/i18n';
import { LOCALES } from '../../src/i18n/locales';

const MANIFEST_CODES = [
  'desktop.update_manifest_missing',
  'desktop.update_manifest_unreadable',
  'desktop.update_manifest_untrusted',
  'desktop.update_manifest_stale',
  'desktop.update_manifest_mismatch',
] as const;

const words = (code: string) =>
  describeUpdateError(i18n, { messageKey: `errors.${code}`, params: { channel: 'stable' } });

describe('update manifest refusals', () => {
  it('have their own words, in every language', async () => {
    for (const locale of LOCALES) {
      await activateLocale(locale);
      const said = MANIFEST_CODES.map(words);
      const generic = words('desktop.not_a_known_error');
      for (const [index, line] of said.entries()) {
        expect(line, `${locale} ${MANIFEST_CODES[index]}`).not.toBe(generic);
        expect(line, `${locale} ${MANIFEST_CODES[index]}`).not.toContain('errors.desktop');
      }
      expect(new Set(said).size, locale).toBe(MANIFEST_CODES.length);
    }
    await activateLocale('en');
    expect(words('desktop.update_manifest_untrusted')).toBe(
      'The update details weren’t signed by Taalcut, so nothing was downloaded. Nothing on this Mac changed.',
    );
  });
});
