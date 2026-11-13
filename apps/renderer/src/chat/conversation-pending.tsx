// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { Skeleton } from '@taalcut/ui';
import { PageColumn } from '../shell/page';
import { ToolbarTitle } from '../shell/toolbar';

/**
 * A chat while its code loads: the window bar's name (portalled into the bar) and the transcript's bones where the
 * transcript will be (ConversationView's column and padding). The routes keep it out of their split chunks, so it
 * shows at once: within 100 ms of navigating (PRD R32, skeleton.spec.ts).
 */
export function ConversationPending() {
  const { t } = useLingui();
  return (
    <PageColumn width="reading" className="pt-6 pb-6">
      <ToolbarTitle title={t`Agent`} />
      <Skeleton name="chat-transcript" loading>
        {null}
      </Skeleton>
    </PageColumn>
  );
}
