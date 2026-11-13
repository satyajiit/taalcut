// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's sharing (Details; UX4 tpl) · system: DESIGN.md v0.6 + UX4
 * two labelled actions where they used to hide in the bar's Share menu: Share to the community… (the hub dialog)
 *   and Export file… (the Save panel), with the last submission's chip before them. The agent's hub.openShare and a
 *   card's Share open the dialog straight away: their request lands on this page (share-requests.ts)
 * states: default · hover · focus-visible · active (the Buttons') · Export loading ("Exporting") · error (the toast
 *   says why) · success (the toast names the file; the dialog's sent state)
 */
import { useLingui } from '@lingui/react/macro';
import type { Template, TemplateSummary } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useExportTemplateFile } from '../library/export-template-file';
import { ShareToHubDialog, SubmissionChip, useLastSubmission } from '../hub/share-to-hub';
import { takeShareRequest, useShareRequest } from '../hub/share-requests';
import { TEMPLATE_ICONS } from '../template-icons';

export function TemplateShare({
  summary,
  template,
}: {
  readonly summary: TemplateSummary;
  readonly template: Template;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const submission = useLastSubmission(template.id);
  const exporting = useExportTemplateFile(template.id, template.version);
  const request = useShareRequest();

  // The agent's hub.openShare, a card's Share: the request waits until this page is the template's.
  useEffect(() => {
    if (request && takeShareRequest(template.id)) setOpen(true);
  }, [request, template.id]);

  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="template-share">
      {submission.latest ? <SubmissionChip submission={submission.latest} /> : null}
      <Button icon={TEMPLATE_ICONS.community} data-slot="share-to-hub" onClick={() => setOpen(true)}>
        {t`Share to the community…`}
      </Button>
      <Button
        variant="ghost"
        icon={VERB_ICONS.download}
        loading={exporting.saving}
        data-slot="export-template-file"
        onClick={() => void exporting.save()}
      >
        {exporting.saving ? t`Exporting` : t`Export file…`}
      </Button>
      <ShareToHubDialog
        summary={summary}
        template={template}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A share may have gone: read the submission's state again.
          if (!next) submission.refresh();
        }}
      />
    </div>
  );
}
