// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { PaletteItem } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { Languages } from 'lucide-react';
import { LANGUAGE_NAMES } from '../../i18n/use-locale';
import { LANGUAGE_ANCHOR } from '../settings/language/language-section';
import { uiCommand, type ListedCommands } from './ui-command';

/**
 * P3-L2: core's go.language, "Change language…": Settings › About at Language, the choice focused. Each
 * language's own name is a keyword too, so a person can find it in a language they read.
 */
export function useLanguageItem(commands: ListedCommands, group: string): PaletteItem {
  const { t } = useLingui();
  const navigate = useNavigate();
  return {
    id: 'go.language',
    title: t`Change language…`,
    group,
    keywords: [t`language`, t`translation`, ...Object.values(LANGUAGE_NAMES)],
    icon: <Languages aria-hidden />,
    ...uiCommand(commands, 'go.language'),
    run: () => navigate({ to: '/settings/about', hash: LANGUAGE_ANCHOR }),
  };
}
