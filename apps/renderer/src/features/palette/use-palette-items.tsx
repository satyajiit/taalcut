// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  MODEL_COMMANDS,
  newId,
  UI_COMMAND_NAMES,
  type ProjectId,
  type ThemePreference,
} from '@taalcut/core';
import { useKeyboard, useTheme, VERB_ICONS, type PaletteItem } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Cpu,
  ListRestart,
  MessageSquarePlus,
  Monitor,
  Moon,
  PanelLeft,
  PawPrint,
  Redo2,
  Sun,
  Undo2,
} from 'lucide-react';
import type { Backend } from '../../backend/backend';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { addCurrentSelection, useCurrentSelection } from '../../chat/selection-store';
import { useCurrentProject } from '../../shell/current-project';
import { useKaatuCommand } from '../kaatu/kaatu-command';
import { describeError, translateKey } from '../settings/model-messages';
import { paletteOffer } from './internal-commands';
import { toggleSidebar, useSidebarCollapsed } from '../../shell/sidebar-state';
import { useNavigationItems } from './navigation-items';
import { usePhase3Presets } from './phase3-items';
import { onKeyboard, uiCommand } from './ui-command';

const THEME_COMMAND = 'settings.setTheme';
const SOMETHING = msg`that`;

type Outcome = Promise<void | { error: string }>;

async function loadPaletteData(backend: Backend, projectId: ProjectId | null, signal: AbortSignal) {
  const [commands, history, models] = await Promise.all([
    backend.commands.list(undefined, { signal }),
    backend.commands.history({ projectId }, { signal }),
    backend.models.settings(undefined, { signal }).catch(() => null),
  ]);
  return { commands, history, models };
}

function dispatcher(backend: Backend, i18n: I18n) {
  return async (name: string, payload: unknown): Outcome => {
    const result = await callRpc(backend.commands.dispatch({ name, payload, source: 'ui' }));
    if (!result.ok) return { error: describeError(i18n, result.error) };
  };
}

/**
 * Every UI command for ⌘K: pages to go to, then every command the bus lists
 * (with presets for the ones that take a choice, like a theme or a profile),
 * and undo/redo. Shortcuts come from the bus's list, like the app menu's, and
 * internal commands stay hidden. `version` reloads the list, e.g. each time
 * ⌘K opens.
 */
export function usePaletteItems(version: number): PaletteItem[] {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const theme = useTheme();
  const sidebarCollapsed = useSidebarCollapsed();
  const kaatu = useKaatuCommand();
  // Each change on the bus (from anywhere: Settings, the agent, undo) refreshes what Undo and Redo say,
  // so ⌘Z works right after a change without opening ⌘K first.
  const [changes, setChanges] = useState(0);
  useBackendEvents(['command.changed'], () => setChanges((n) => n + 1));
  // The project page on screen (the editor) makes its history the one undo and redo use.
  const projectId = useCurrentProject();
  const selected = useCurrentSelection();
  const data = useRpcQuery(
    (signal) => loadPaletteData(backend, projectId, signal),
    [backend, projectId, version, changes],
  );
  const dispatch = dispatcher(backend, i18n);
  const keyboard = useKeyboard();
  const commands = new Map(data.data?.commands.map((c) => [c.name, onKeyboard(c, keyboard)]));
  const items: PaletteItem[] = [...useNavigationItems(commands)];
  const listed = new Set(commands.keys());
  // Core's UI commands have items of their own: navigation above, undo and redo below.
  const uiCommands = new Set<string>(UI_COMMAND_NAMES);

  // Theme: a bus command when the bus has it (one path for ⌘K, the menu and the agent), else the engine.
  const themeGroup = t`Appearance`;
  const themes: [ThemePreference, string, typeof Sun][] = [
    ['system', t`Match the Mac’s light or dark setting`, Monitor],
    ['light', t`Use the light theme`, Sun],
    ['dark', t`Use the dark theme`, Moon],
  ];
  for (const [preference, title, Icon] of themes) {
    items.push({
      id: `theme.${preference}`,
      title,
      group: themeGroup,
      keywords: [t`appearance`, t`colours`, t`dark mode`],
      icon: <Icon aria-hidden />,
      command: listed.has(THEME_COMMAND) ? THEME_COMMAND : undefined,
      disabled: theme.preference === preference,
      run: () =>
        listed.has(THEME_COMMAND) ? dispatch(THEME_COMMAND, { preference }) : theme.setPreference(preference),
    });
  }

  // View › Toggle Sidebar (⌃⌘S, Ctrl+B on a PC): core's view.sidebar UI command, run here because the sidebar
  // is the page's.
  items.push({
    id: 'view.sidebar',
    title: sidebarCollapsed ? t`Expand sidebar` : t`Collapse sidebar`,
    group: t`View`,
    keywords: [t`sidebar`, t`chats`, t`rail`, t`hide`, t`show`],
    icon: <PanelLeft aria-hidden />,
    ...uiCommand(commands, 'view.sidebar'),
    run: toggleSidebar,
  });

  // View › Show or Hide Kaatu (UX4): the companion at the sidebar's foot, by the preference's state.
  items.push({ ...kaatu, group: t`View`, icon: <PawPrint aria-hidden /> });

  // Chat › New chat (UX4): an empty chat, the sidebar's New chat.
  items.push({
    id: 'chat.new',
    title: t`New chat`,
    group: t`Chat`,
    keywords: [t`start`, t`agent`, t`ask`, t`conversation`],
    icon: <VERB_ICONS.newChat aria-hidden />,
    run: () => navigate({ to: '/chat/$conversationId', params: { conversationId: newId<'Conversation'>() } }),
  });

  // Chat › Add to chat (⌘⇧A): what the editor has selected goes into the composer as a chip.
  items.push({
    id: 'chat.addSelection',
    title: t`Add the selection to the chat`,
    group: t`Chat`,
    keywords: [t`point at`, t`clip`, t`selection`, t`ask`],
    icon: <MessageSquarePlus aria-hidden />,
    ...uiCommand(commands, 'chat.addSelection'),
    disabled: !selected,
    run: async () => {
      if (addCurrentSelection() === 'full') return { error: t`A message can point at 20 things at most` };
    },
  });

  const modelsGroup = t`Models`;
  const models = data.data?.models;
  if (listed.has(MODEL_COMMANDS.setProfile) && models) {
    for (const profile of models.profiles) {
      const name = translateKey(i18n, profile.labelKey, SOMETHING);
      items.push({
        id: `profile.${profile.id}`,
        title: t`Think with “${name}”`,
        group: modelsGroup,
        keywords: [t`profile`, t`models`, t`quality`, t`cost`],
        icon: <Cpu aria-hidden />,
        command: MODEL_COMMANDS.setProfile,
        disabled: profile.id === models.activeProfileId,
        run: () => dispatch(MODEL_COMMANDS.setProfile, { profileId: profile.id }),
      });
    }
  }
  const presets: Record<string, Omit<PaletteItem, 'id' | 'group' | 'command'>> = {
    [MODEL_COMMANDS.useRecommended]: {
      title: t`Use the recommended models`,
      keywords: [t`reset`, t`default`],
      icon: <ListRestart aria-hidden />,
      run: () => dispatch(MODEL_COMMANDS.useRecommended, {}),
    },
    // These take a job and a model, so they open the screen where you choose.
    [MODEL_COMMANDS.setModuleOverride]: {
      title: t`Choose a model for each job…`,
      keywords: [t`advanced`, t`thinking level`],
      icon: <Cpu aria-hidden />,
      run: () => navigate({ to: '/settings/models', search: { advanced: true } }),
    },
    [MODEL_COMMANDS.clearModuleOverride]: {
      title: t`Reset a job to its profile’s model…`,
      keywords: [t`advanced`, t`undo`],
      icon: <Cpu aria-hidden />,
      run: () => navigate({ to: '/settings/models', search: { advanced: true } }),
    },
  };

  const phase3 = usePhase3Presets();
  const ownItems = new Set([...Object.keys(presets), ...Object.keys(phase3)]);

  // Every other command the bus lists: through its preset or opener, else by its label, run as is when it needs no
  // payload (paletteOffer).
  for (const info of data.data?.commands ?? []) {
    if (uiCommands.has(info.name) || info.name === THEME_COMMAND || info.name === MODEL_COMMANDS.setProfile)
      continue;
    if (paletteOffer(info, ownItems.has(info.name)) === 'hidden') continue;
    const preset = presets[info.name];
    const opens = phase3[info.name];
    const name = info.name;
    items.push(
      preset
        ? { ...preset, id: `command.${info.name}`, group: modelsGroup, command: info.name }
        : opens
          ? { ...opens, id: `command.${info.name}`, command: info.name }
          : {
              id: `command.${info.name}`,
              title: translateKey(i18n, info.labelKey, msg`Run ${name}`),
              group: t`Commands`,
              command: info.name,
              // The bus's key binding (P1-C4), bound with the other items' shortcuts.
              ...(info.shortcut ? { shortcut: info.shortcut } : {}),
              run: () => dispatch(info.name, {}),
            },
    );
  }

  // Undo and redo: the open project's history on its page (the editor), app-wide changes (settings) elsewhere.
  const history = data.data?.history;
  const editGroup = t`Edit`;
  const label = (name: string | null | undefined) => translateKey(i18n, `commands.${name ?? ''}`, SOMETHING);
  const undoLabel = label(history?.undo);
  const redoLabel = label(history?.redo);
  items.push(
    {
      id: 'edit.undo',
      title: history?.undo ? t`Undo “${undoLabel}”` : t`Undo`,
      group: editGroup,
      icon: <Undo2 aria-hidden />,
      ...uiCommand(commands, 'edit.undo'),
      disabled: !history?.undo,
      run: async () => {
        const result = await callRpc(backend.commands.undo({ projectId, source: 'ui' }));
        if (!result.ok) return { error: describeError(i18n, result.error) };
      },
    },
    {
      id: 'edit.redo',
      title: history?.redo ? t`Redo “${redoLabel}”` : t`Redo`,
      group: editGroup,
      icon: <Redo2 aria-hidden />,
      ...uiCommand(commands, 'edit.redo'),
      disabled: !history?.redo,
      run: async () => {
        const result = await callRpc(backend.commands.redo({ projectId, source: 'ui' }));
        if (!result.ok) return { error: describeError(i18n, result.error) };
      },
    },
  );
  return items;
}
