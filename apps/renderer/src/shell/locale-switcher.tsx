// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useHostPlatform,
} from '@taalcut/ui';
import { Languages } from 'lucide-react';
import { useCommand } from '../backend/use-command';
import { activateLocale, storeLocale } from '../i18n/i18n';
import { isAppLocale, isLocale, LOCALES, PSEUDO_LOCALE } from '../i18n/locales';
import { LANGUAGE_NAMES, setLocaleRequest } from '../i18n/use-locale';

/**
 * Developer-only: every catalogue, the pseudo-locale included, without a restart. The shell renders it only in
 * dev builds (import.meta.env.DEV). A real language is the app's setting (the same command as Settings › About ›
 * Language); the pseudo-locale is a local override that the setting doesn't touch.
 */
export function LocaleSwitcher() {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const platform = useHostPlatform();

  async function choose(value: string) {
    if (!isLocale(value)) return;
    if (isAppLocale(value)) {
      storeLocale(null);
      await command.run(setLocaleRequest(value));
    } else {
      storeLocale(value);
    }
    await activateLocale(value, platform);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t`Language (developer)`}>
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuLabel>{t`Language (developer)`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={i18n.locale} onValueChange={(value) => void choose(value)}>
          {LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {locale === PSEUDO_LOCALE ? (
                t`Pseudo-locale`
              ) : (
                <span lang={locale} translate="no">
                  {LANGUAGE_NAMES[locale]}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
