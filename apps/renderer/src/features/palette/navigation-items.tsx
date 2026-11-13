// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, renderIcon, VERB_ICONS, type IconLike, type PaletteItem } from '@taalcut/ui';
import { useNavigate, type LinkProps } from '@tanstack/react-router';
import {
  Activity,
  Blocks,
  Bug,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageSquareText,
  Settings,
  Smartphone,
  Star,
} from 'lucide-react';
import { useOpenExternal } from '../../chat/open-external';
import { AREAS } from '../../shell/areas';
import { GITHUB_FEATURE_URL, GITHUB_ISSUE_URL, GITHUB_REPO_URL } from '../../shell/github-links';
import { BACK_SHORTCUT, FORWARD_SHORTCUT } from '../../shell/nav/history-keys';
import { useHistoryNav } from '../../shell/nav/use-history-nav';
import { openFeedback } from '../feedback/feedback-state';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { useLanguageItem } from './language-item';
import { uiCommand, type ListedCommands } from './ui-command';

/**
 * Going places: Back and Forward (⌘[ and ⌘], the window's history, as the
 * window bar's chevrons and the View menu), core's go.* UI commands (⌘1–⌘4
 * for the four areas, ⌘, for Settings, as `commands` lists them), run here
 * because moving between pages is the page's job. The same item runs when
 * main's menu sends its id as a `ui.action`. Then each Settings section
 * (Privacy as go.privacy), Help (Send feedback as help.feedback, and the
 * GitHub pages the Help menu lists too), and the developer pages.
 */
export function useNavigationItems(commands: ListedCommands): PaletteItem[] {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const history = useHistoryNav();
  const openExternal = useOpenExternal();
  const go = (to: LinkProps['to']) => () => navigate({ to });
  const goGroup = t`Go to`;
  const settingsGroup = t`Settings`;
  const helpGroup = t`Help`;

  const items: PaletteItem[] = [
    {
      id: 'nav.back',
      title: t`Back`,
      group: goGroup,
      keywords: [t`previous page`, t`history`],
      icon: <ChevronLeft aria-hidden />,
      shortcut: BACK_SHORTCUT,
      disabled: !history.canGoBack,
      run: history.back,
    },
    {
      id: 'nav.forward',
      title: t`Forward`,
      group: goGroup,
      keywords: [t`next page`, t`history`],
      icon: <ChevronRight aria-hidden />,
      shortcut: FORWARD_SHORTCUT,
      disabled: !history.canGoForward,
      run: history.forward,
    },
  ];
  // Make is the area's one name (its list of projects is the area's page), so there is no separate Projects item.
  for (const area of AREAS) {
    items.push({
      id: `go.${area.id}`,
      title: i18n._(area.label),
      group: goGroup,
      ...(area.id === 'make' ? { keywords: [t`projects`, t`videos`, t`timelines`, t`edit`] } : {}),
      icon: <area.icon aria-hidden className={area.iconClass} />,
      ...uiCommand(commands, `go.${area.id}`),
      run: go(area.to),
    });
  }
  items.push({
    id: 'go.settings',
    title: t`Settings`,
    group: goGroup,
    keywords: [t`preferences`],
    icon: <Settings aria-hidden />,
    ...uiCommand(commands, 'go.settings'),
    run: go('/settings/general'),
  });
  // Make's other two views (the make lane's Projects, Exports and Archived), by what they are.
  items.push(
    {
      id: 'go.make.exports',
      title: t`Exports`,
      group: goGroup,
      keywords: [t`export`, t`renders`, t`finished videos`, t`share`, t`download`],
      icon: <CONCEPT_ICONS.export aria-hidden />,
      run: go('/renders'),
    },
    {
      id: 'go.make.archived',
      title: t`Archived projects`,
      group: goGroup,
      keywords: [t`archive`, t`put away`],
      icon: <CONCEPT_ICONS.archived aria-hidden />,
      run: () => navigate({ to: '/projects', search: { archived: true } }),
    },
    {
      id: 'go.make.style',
      title: t`Your style`,
      group: goGroup,
      keywords: [t`style profile`, t`what my videos have in common`],
      icon: <CONCEPT_ICONS.styleProfile aria-hidden />,
      run: go('/projects/style'),
    },
  );
  // The Templates area's places (the tpl lane, UX4): New, Start from… (and its Community), Saved on Instagram.
  items.push(
    {
      id: 'go.templates.new',
      title: t`New template`,
      group: goGroup,
      keywords: [t`template`, t`reel`, t`link`, t`import`, t`make a template`],
      icon: <VERB_ICONS.add aria-hidden />,
      run: go('/templates/new'),
    },
    {
      id: 'go.templates.start',
      title: t`Start from…`,
      group: goGroup,
      keywords: [t`templates`, t`starters`, t`formats`, t`ready-made`],
      icon: <CONCEPT_ICONS.startFrom aria-hidden />,
      run: go('/templates/start'),
    },
    {
      id: 'go.templates.hub',
      title: t`Browse the community`,
      group: goGroup,
      keywords: [t`templates`, t`hub`, t`community`, t`shared`, t`copy`],
      icon: <CONCEPT_ICONS.hub aria-hidden />,
      run: go('/templates/start/community'),
    },
    {
      id: 'go.templates.saved',
      title: t`Saved on Instagram`,
      group: goGroup,
      keywords: [t`Instagram`, t`saved reels`, t`collections`],
      icon: <CONCEPT_ICONS.saved aria-hidden />,
      run: go('/templates/saved'),
    },
  );
  items.push({
    id: 'go.library.phone',
    title: t`From your phone`,
    group: goGroup,
    keywords: [t`Wi-Fi`, t`import`, t`QR code`, t`iPhone`],
    icon: <Smartphone aria-hidden />,
    run: go('/library/phone'),
  });

  // Settings' sections (the rail's order, settings-sections.ts), then the views a person looks for by name (UX4).
  const sections: [LinkProps['to'], string, IconLike, string[]][] = [
    [
      '/settings/general',
      t`General`,
      SETTINGS_ICONS.general,
      [t`appearance`, t`theme`, t`sounds`, t`Kaatu`, t`tips`],
    ],
    ['/settings/updates', t`Updates`, SETTINGS_ICONS.updates, [t`update`, t`beta`, t`version`]],
    ['/settings/this-mac', t`This Mac`, SETTINGS_ICONS.thisMac, [t`hardware`, t`GPU`, t`installed parts`]],
    ['/settings/about', t`About`, SETTINGS_ICONS.about, [t`version`, t`licences`]],
    ['/settings/sources', t`Sources`, SETTINGS_ICONS.sources, [t`folder`, t`phone`]],
    [
      '/settings/brand',
      t`Brand kits`,
      SETTINGS_ICONS.brandKits,
      [t`logo`, t`colours`, t`fonts`, t`look`, t`style`],
    ],
    ['/settings/memory', t`Memory`, SETTINGS_ICONS.memory, []],
    ['/settings/models', t`Models`, SETTINGS_ICONS.models, [t`profile`, t`AI`]],
    ['/settings/models/downloads', t`Model downloads`, SETTINGS_ICONS.downloads, [t`download`, t`offline`]],
    ['/settings/accounts', t`Accounts`, SETTINGS_ICONS.accounts, [t`ChatGPT`, t`sign in`]],
    ['/settings/accounts/keys', t`API keys`, SETTINGS_ICONS.keys, [t`API key`, t`OpenAI`, t`Anthropic`]],
    [
      '/settings/accounts/subscriptions',
      t`Subscriptions`,
      SETTINGS_ICONS.subscriptions,
      [t`ChatGPT`, t`Claude`, t`plan`],
    ],
    [
      '/settings/accounts/servers',
      t`Your own servers`,
      SETTINGS_ICONS.servers,
      [t`Ollama`, t`LM Studio`, t`local server`],
    ],
    ['/settings/privacy', t`Privacy`, SETTINGS_ICONS.privacy, [t`Local only`]],
    [
      '/settings/privacy/sharing',
      t`Help improve Taalcut`,
      SETTINGS_ICONS.sharing,
      [t`crash reports`, t`usage counts`, t`telemetry`],
    ],
    ['/settings/usage', t`Usage`, SETTINGS_ICONS.usage, [t`cost`, t`tokens`]],
    [
      '/settings/usage/breakdown',
      t`Usage breakdown`,
      SETTINGS_ICONS.breakdown,
      [t`cost`, t`by job`, t`by project`],
    ],
    ['/settings/usage/budgets', t`Budgets`, SETTINGS_ICONS.budgets, [t`budget`, t`cap`, t`limit`]],
    ['/settings/usage/requests', t`Requests to models`, SETTINGS_ICONS.requests, [t`requests`, t`log`]],
    ['/settings/plugins', t`Plugins`, SETTINGS_ICONS.plugins, [t`MCP`]],
    [
      '/settings/external-agents',
      t`External agents`,
      SETTINGS_ICONS.externalAgents,
      [t`Claude Code`, t`Codex`, t`MCP`],
    ],
  ];
  for (const [to, title, Icon, keywords] of sections) {
    // Privacy is core's go.privacy too: Local only's errors fix with it, and the menu sends it.
    const privacy = to === '/settings/privacy';
    items.push({
      id: privacy ? 'go.privacy' : `go.${String(to)}`,
      title,
      group: settingsGroup,
      keywords,
      icon: renderIcon(Icon),
      ...(privacy ? uiCommand(commands, 'go.privacy') : {}),
      run: go(to),
    });
  }

  items.push(useLanguageItem(commands, settingsGroup));

  // Help → Send feedback: core's help.feedback, carried out by the page (the dialog the root mounts).
  items.push({
    id: 'help.feedback',
    title: t`Send feedback…`,
    group: helpGroup,
    keywords: [t`report`, t`bug`, t`problem`, t`debug bundle`],
    icon: <MessageSquareText aria-hidden />,
    ...uiCommand(commands, 'help.feedback'),
    run: () => openFeedback(),
  });
  // Help → the project on GitHub, in the browser (the Help menu sends these ids too; Settings › About links them).
  const github: [string, string, string, typeof Star, string[]][] = [
    ['help.github', t`Star Taalcut on GitHub`, GITHUB_REPO_URL, Star, [t`source code`, t`open source`]],
    ['help.reportIssue', t`Report an issue on GitHub`, GITHUB_ISSUE_URL, Bug, [t`bug`, t`problem`]],
    [
      'help.requestFeature',
      t`Request a feature on GitHub`,
      GITHUB_FEATURE_URL,
      Lightbulb,
      [t`idea`, t`wish`],
    ],
  ];
  for (const [id, title, url, Icon, keywords] of github)
    items.push({
      id,
      title,
      group: helpGroup,
      keywords: [t`GitHub`, ...keywords],
      icon: <Icon aria-hidden />,
      run: () => openExternal(url),
    });

  // Developer pages: the routes exist in every build; the sidebar and ⌘K show them only in dev.
  if (import.meta.env.DEV) {
    const devGroup = t`Developer`;
    items.push(
      {
        id: 'go.dev.traces',
        title: t`Traces`,
        group: devGroup,
        icon: <Activity aria-hidden />,
        run: go('/dev/traces'),
      },
      {
        id: 'go.dev.kit',
        title: t`UI kit`,
        group: devGroup,
        icon: <Blocks aria-hidden />,
        run: go('/dev/kit'),
      },
    );
  }
  return items;
}
