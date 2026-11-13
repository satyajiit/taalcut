// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: Share dialog body (template page, P3-B12) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · ShareTemplateView (U3) on the dialog's surface, fed by the share
 *   flow; Show slot closes the dialog and selects that slot on the page behind it
 * states: the view's: checking · problems · ready · sending · sent · refused (rate limit, not connected, Local only)
 */
import { useNavigate } from '@tanstack/react-router';
import { ShareTemplateView } from '@taalcut/ui';
import type { FixAction, Template, TemplateSummary } from '@taalcut/core';
import { fixCommand } from '../../../backend/fix-command';
import { useCommand } from '../../../backend/use-command';
import { HUB_LANGUAGES } from './hub-words';
import { useShareFlow } from './use-share-flow';

export interface ShareDialogBodyProps {
  readonly summary: TemplateSummary;
  readonly template: Template;
  onClose(): void;
}

/** The template page's slot strip: select the slot a problem is in, once the dialog is closed. */
function showSlot(index: number): void {
  window.setTimeout(() => {
    const slot = window.document.querySelector<HTMLElement>(
      `[data-slot="slot-strip"] [data-slot-index="${index}"]`,
    );
    slot?.click();
    slot?.focus();
  }, 0);
}

export function ShareDialogBody({ summary, template, onClose }: ShareDialogBodyProps) {
  const flow = useShareFlow(summary, template);
  const command = useCommand({ toast: false });
  const navigate = useNavigate();
  const languages = [...new Set([...(template.language ? [template.language] : []), ...HUB_LANGUAGES])];
  const onFix = (fix: FixAction) => {
    onClose();
    // Local only's fix is Privacy (go.privacy): the page, not a change.
    if (fix.command === 'go.privacy') return void navigate({ to: '/settings/privacy' });
    return command.run(fixCommand(fix));
  };
  return (
    <ShareTemplateView
      document={flow.document}
      form={flow.form}
      onFormChange={flow.setForm}
      problems={flow.problems}
      status={flow.status}
      acknowledged={flow.acknowledged}
      onAcknowledge={flow.acknowledge}
      onSubmit={() => void flow.submit()}
      onCancel={onClose}
      onShowSlot={(index) => {
        onClose();
        showSlot(index);
      }}
      error={flow.error}
      onFix={onFix}
      languages={languages}
      hasLook={template.styleId !== null}
    />
  );
}
