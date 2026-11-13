// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: Share to the hub (template page, P3-B12) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · the Share dialog (ShareTemplateView, U3, the dialog's one marigold
 *   Submit), opened from the window bar's Share menu (template-share-menu.tsx); and the last submission's state as
 *   a chip beside that menu: In review (neutral), In the hub (success, a link to its page), Not accepted (warning,
 *   why in its title), Removed from the hub (warning)
 * states: the dialog's: checking · problems · ready · sending · sent · refused (share-dialog.tsx); the chip's link:
 *   default · hover · focus-visible · active
 */
import { useLingui } from '@lingui/react/macro';
import type { HubSubmissionView, Template, TemplateId, TemplateSummary } from '@taalcut/core';
import { Chip, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { ShareDialogBody } from './share-dialog';

export function SubmissionChip({ submission }: { readonly submission: HubSubmissionView }) {
  const { t } = useLingui();
  switch (submission.state) {
    case 'open':
      return (
        <Chip
          title={t`A maintainer checks it before it appears in the hub, usually within a week.`}
        >{t`In review`}</Chip>
      );
    case 'merged':
      return (
        <Link to="/templates/start/community/$hubId" params={{ hubId: submission.hubId }} className="rounded-pill">
          <Chip tone="success">{t`In the hub`}</Chip>
        </Link>
      );
    case 'closed':
      return (
        <Chip
          tone="warning"
          title={t`A maintainer didn’t accept this version. Change it and share it again.`}
        >
          {t`Not accepted`}
        </Chip>
      );
    case 'hidden':
      return <Chip tone="warning">{t`Removed from the hub`}</Chip>;
  }
}

/** This template's last submission to the hub, read again after the dialog closes (a share may have gone). */
export function useLastSubmission(templateId: TemplateId) {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const submissions = useRpcQuery(
    (signal) => backend.hub.submissions({ templateId, refresh: true }, { signal }),
    [backend, templateId, round],
  );
  return { latest: submissions.data?.at(-1), refresh: () => setRound((n) => n + 1) };
}

export function ShareToHubDialog({
  summary,
  template,
  open,
  onOpenChange,
}: {
  readonly summary: TemplateSummary;
  readonly template: Template;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t`Share to the template hub`}</DialogTitle>
          <DialogDescription>
            {t`Only the template’s structure goes: the cuts, the beats and where text goes. A maintainer checks it first.`}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ShareDialogBody summary={summary} template={template} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
