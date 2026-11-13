// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ReviewPage } from '../../../../chat/review-page';
import { PageColumn } from '../../../../shell/page';
import { ToolbarTitle } from '../../../../shell/toolbar';

/**
 * The chat's one approval as a page (UX4, B8): /chat/<chat>/review/<approval>. The crumbs read "Agent › <the chat's
 * name> › Review"; Escape, Export and Not now go back to the chat.
 */
export const Route = createFileRoute('/_shell/chat/$conversationId/review/$approvalId')({
  component: Review,
  pendingComponent: ReviewPending,
  pendingMs: 0,
  pendingMinMs: 0,
  codeSplitGroupings: [['component'], ['errorComponent'], ['notFoundComponent']],
});

function Review() {
  const { approvalId } = Route.useParams();
  return <ReviewPage approvalId={approvalId} />;
}

/** While the page's code comes: the bar's name and the stage's grey where the video will be. */
function ReviewPending() {
  const { t } = useLingui();
  return (
    <PageColumn width="reading" className="pt-6 pb-10">
      <ToolbarTitle title={t`Agent`} />
      <div
        data-slot="loading"
        aria-busy="true"
        className="tc-viewer rounded-xl"
        style={{ height: 'max(20rem, calc(100dvh - var(--spacing-toolbar) - 11rem))' }}
      />
    </PageColumn>
  );
}
