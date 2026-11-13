// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { HUB_COMMANDS, STYLE_COMMANDS, TEMPLATE_COMMANDS, type TemplateId } from '@taalcut/core';
import type { PaletteItem } from '@taalcut/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { FolderInput, Palette, Share2 } from 'lucide-react';
import { searchId } from '../../shell/route-id';
import { openHubShare } from '../templates/hub/share-requests';

/** A bus command's ⌘K item that opens the screen where it is done (it needs what that screen picks). */
export type CommandPreset = Omit<PaletteItem, 'id' | 'command'>;

const TEMPLATE_PAGE = /^\/templates\/([^/]+)$/;

/** The template the page on screen shows (/templates/<id>), if any. */
function useTemplateOnScreen(): TemplateId | undefined {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return searchId<'Template'>(TEMPLATE_PAGE.exec(pathname)?.[1]);
}

/**
 * Phase 3's commands that ⌘K offers by what they are for: Share to the hub (P3-B12) opens the Share dialog of the
 * template on screen, or the templates to pick one; Move to folder (P3-V14) and New brand kit (P3-V10) open the
 * page where you choose (HFW1 retire: the Motion design switch is gone). The rest of Phase 3's commands
 * need their page's payload: the bus marks them `needsPayload`, and ⌘K leaves them to their page
 * (internal-commands.ts).
 */
export function usePhase3Presets(): Readonly<Record<string, CommandPreset>> {
  const { t } = useLingui();
  const navigate = useNavigate();
  const templateId = useTemplateOnScreen();
  // Not "Templates": that heading lists your templates by name once something is typed (use-found-items.tsx).
  const templatesGroup = t`Template actions`;
  return {
    [HUB_COMMANDS.openShare]: {
      title: t`Share to the hub…`,
      group: templatesGroup,
      keywords: [t`hub`, t`publish`, t`template`],
      icon: <Share2 aria-hidden />,
      run: () => (templateId ? openHubShare(navigate, templateId) : void navigate({ to: '/templates' })),
    },
    [TEMPLATE_COMMANDS.moveToFolder]: {
      title: t`Move templates to a folder…`,
      group: templatesGroup,
      keywords: [t`folder`, t`organise`, t`library`],
      icon: <FolderInput aria-hidden />,
      run: () => void navigate({ to: '/templates' }),
    },
    [STYLE_COMMANDS.create]: {
      title: t`New brand kit…`,
      group: t`Settings`,
      keywords: [t`brand`, t`logo`, t`colours`, t`fonts`, t`look`],
      icon: <Palette aria-hidden />,
      run: () => void navigate({ to: '/settings/brand' }),
    },
  };
}
