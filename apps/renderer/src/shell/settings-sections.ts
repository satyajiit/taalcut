// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { SETTINGS_ICONS } from '../features/settings/settings-icons';

export type SettingsGroupId = 'general' | 'work' | 'ai' | 'connections';

export interface SettingsSection {
  to: LinkProps['to'];
  label: MessageDescriptor;
  icon: LucideIcon;
  group: SettingsGroupId;
  /** Other pages this section stands for: General's row stays current on Updates, This Mac and About. */
  also?: readonly string[];
}

export interface SettingsGroup {
  id: SettingsGroupId;
  /** None for the first group: General leads the list on its own, as macOS's does. */
  title: MessageDescriptor | null;
}

/**
 * Settings' groups, by what a creator came to do (UX4, set lane): the app itself, their own work, the models with
 * what they cost and what they send, then what connects to Taalcut from outside. On the rail a hairline stands
 * between groups, and the ten rows and three hairlines fit the smallest window (960 × 600).
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'general', title: null },
  { id: 'work', title: msg`Your work` },
  { id: 'ai', title: msg`AI and privacy` },
  { id: 'connections', title: msg`Connections` },
];

/** Settings' left-side sections on the dedicated /settings route, in order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    to: '/settings/general',
    label: msg`General`,
    icon: SETTINGS_ICONS.general,
    group: 'general',
    also: ['/settings/updates', '/settings/this-mac', '/settings/about'],
  },
  { to: '/settings/sources', label: msg`Sources`, icon: SETTINGS_ICONS.sources, group: 'work' },
  { to: '/settings/brand', label: msg`Brand kits`, icon: SETTINGS_ICONS.brandKits, group: 'work' },
  { to: '/settings/memory', label: msg`Memory`, icon: SETTINGS_ICONS.memory, group: 'work' },
  { to: '/settings/models', label: msg`Models`, icon: SETTINGS_ICONS.models, group: 'ai' },
  { to: '/settings/accounts', label: msg`Accounts`, icon: SETTINGS_ICONS.accounts, group: 'ai' },
  { to: '/settings/privacy', label: msg`Privacy`, icon: SETTINGS_ICONS.privacy, group: 'ai' },
  { to: '/settings/usage', label: msg`Usage`, icon: SETTINGS_ICONS.usage, group: 'ai' },
  { to: '/settings/plugins', label: msg`Plugins`, icon: SETTINGS_ICONS.plugins, group: 'connections' },
  {
    to: '/settings/external-agents',
    label: msg`External agents`,
    icon: SETTINGS_ICONS.externalAgents,
    group: 'connections',
  },
];
