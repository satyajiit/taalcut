// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ConversationId } from '@taalcut/core';
import { ProjectChat } from './project-chat';

export type DockPanel = 'chat' | 'versions' | 'cleanup' | 'comments' | 'files' | 'look';
export const DOCK_ID = 'editor-dock';

/** The chat and Stop stay reachable while a task uses the editor's lower work area. */
export function EditorDock({ conversationId }: { conversationId: ConversationId | undefined }) {
  const { t } = useLingui();
  return (
    <aside
      id={DOCK_ID}
      aria-label={t`Chat`}
      data-slot="editor-dock"
      className="flex w-80 shrink-0 flex-col border-l border-rule-subtle bg-canvas min-[1280px]:w-90 min-[1440px]:w-100"
    >
      <h2 className="m-0 flex h-11 shrink-0 items-center border-b border-rule-subtle px-4 type-section-title text-ink">
        {t`Chat`}
      </h2>
      <ProjectChat conversationId={conversationId} />
    </aside>
  );
}
