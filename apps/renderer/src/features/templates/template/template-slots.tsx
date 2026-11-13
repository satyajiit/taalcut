// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's slots (/templates/$templateId/slots; P2-T6, UX3, UX4 tpl, BRK1-REV)
 *   · system: DESIGN.md v0.7 + UX4 (PageSection; design-tpl.md)
 * the page's one job is checking the breakdown against the reel and approving it: an icon-led section that says
 *   what approving does, then the review at page size (the same component as the chat's review sheet): the kept
 *   reel playing slot by slot beside the slot in words, the time axis under both, and the route through what
 *   Taalcut isn't sure of, with Approve the rest at its end. `?slot=3` opens on slot 3 (the overview's Open in Slots)
 * states: latest · older version (read-only: it plays and steps, nothing edits; the frame's line says so) · no reel
 *   kept (frames only, and why) · the review's own
 * edits: every change is a template.* command from 'ui': undoable with ⌘Z, Undo and the toast
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc } from '@taalcut/core';
import { PageSection, TemplateReview } from '@taalcut/ui';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useMediaUrls } from '../../../services/provider';
import { TEMPLATE_ICONS } from '../template-icons';
import type { TemplateView } from './template-context';

export function TemplateSlots({ view, slot }: { view: TemplateView; slot?: number | undefined }) {
  const { t } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const { template, summary, latest } = view;
  // A fix's failure shows in the review, beside what it was about; so no toast.
  const command = useCommand({ toast: false });
  const dispatch = (name: string, payload: unknown) => command.run({ name, payload });
  const undo = () => callRpc(backend.commands.undo({ projectId: null, source: 'ui' }));
  const sheetUrl = template.contactSheet ? media.templateAsset(template.contactSheet) : null;
  const reelUrl = summary.media ? media.templateReel(template.id) : null;

  return (
    <PageSection
      headingId="template-slots-title"
      icon={TEMPLATE_ICONS.slots}
      title={t`Slots`}
      description={t`Watch each slot against the reel, fix what’s off, then approve it: Taalcut cuts your clips to it as it is.`}
    >
      <TemplateReview
        key={template.id}
        variant="page"
        template={template}
        reelUrl={reelUrl}
        sheetUrl={sheetUrl}
        projectId={null}
        readOnly={!latest}
        dispatch={dispatch}
        undo={undo}
        propose={(input) => callRpc(backend.templates.proposeEdits(input))}
        {...(slot ? { initialSlot: slot - 1 } : {})}
      />
    </PageSection>
  );
}
