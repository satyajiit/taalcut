// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: media status lines · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the one line under a media card's controls that says how the last thing went: an error
 *   (danger words with a mark, role alert), a follow-up sent to the run or left in the message box (ink-2, role
 *   status), a change made with Undo
 * states: error · success (sent, in the composer, changed: the words) · Undo carries Button's eight states · not
 *   otherwise interactive
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, TaalcutError } from '@taalcut/core';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { mediaErrorMessage } from './media-errors';
import type { FollowUp } from './use-command';

export function MediaError({ error, className }: { error: TaalcutError; className?: string }) {
  const { i18n } = useLingui();
  return (
    <p role="alert" className={cn('m-0 flex items-start gap-2 text-sm text-danger-strong', className)}>
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{mediaErrorMessage(i18n, error)}</span>
    </p>
  );
}

/** How the last follow-up went; nothing before the first. */
export function FollowUpLine({ followUp }: { followUp: FollowUp }) {
  const { t } = useLingui();
  if (followUp.error) return <MediaError error={followUp.error.error} />;
  if (!followUp.outcome) return null;
  return (
    <p role="status" data-slot="follow-up" className="m-0 text-sm text-ink-2">
      {followUp.outcome.outcome === 'sent'
        ? t`Sent to the chat. Taalcut shows what it costs before it makes anything.`
        : t`It’s in the message box. Press Send when you’re ready; Taalcut shows the cost first.`}
    </p>
  );
}

/** A change that went through; undo lives in the History / Versions tab and ⌘Z. */
export function ChangedLine({ children }: { projectId: ProjectId; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        {children}
      </p>
    </div>
  );
}
