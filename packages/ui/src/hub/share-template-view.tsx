// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: ShareTemplateView (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the hub's decision surface, rendered in the renderer's Share dialog: on the left the
 *   StructurePreview of exactly the document that would be sent, its slots and length; on the right what is and
 *   isn't shared, the form, the problems from hub.shareCheck, the CC0 sentence and Submit. Works from 360 px up
 *   (one column), two columns when there is room.
 * states: checking (the problems' bones; Submit off, said why) · problems (the list; Submit off) · ready · sending
 *   (on the button) · sent ("Sent for review…", Done) · refused (rate limit with when to try again; not configured;
 *   Local only with its Privacy fix; any other error line with its fix)
 * motion: the preview's clock only
 */
import { useLingui } from '@lingui/react/macro';
import type { FixAction, HubShareForm, HubTemplateV0, TaalcutError } from '@taalcut/core';
import { CircleCheck } from 'lucide-react';
import { Button } from '../components/button';
import type { FixOutcome } from '../feedback/error-card';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { ShareForm, isHandle } from './share-form';
import { ShareLists } from './share-lists';
import { ShareProblems } from './share-problems';
import { ShareRefused } from './share-refused';
import { ShareSubmit } from './share-submit';
import type { ShareProblem } from './share-words';
import { previewOfStructure } from './structure-of';
import { StructurePreview } from './structure-preview';
import { structureSummary } from './preview-words';

export type ShareStatus = 'checking' | 'ready' | 'sending' | 'sent' | 'refused';

export interface ShareTemplateViewProps {
  /** Exactly what Share would send (hub.shareCheck); null while checking or when it can't be built. */
  readonly document: HubTemplateV0 | null;
  readonly form: HubShareForm;
  onFormChange(form: HubShareForm): void;
  readonly problems: readonly ShareProblem[];
  readonly status: ShareStatus;
  readonly acknowledged: boolean;
  onAcknowledge(acknowledged: boolean): void;
  onSubmit(): void;
  onCancel(): void;
  /** A problem's slot, on the template's page. */
  onShowSlot(slotIndex: number): void;
  /** The refusal (status refused). */
  readonly error: TaalcutError | null;
  /** An error's fix (Local only opens Privacy). */
  readonly onFix?: ((fix: FixAction) => FixOutcome | Promise<FixOutcome>) | undefined;
  readonly languages: readonly string[];
  readonly hasLook: boolean;
  readonly className?: string;
}

export function ShareTemplateView(props: ShareTemplateViewProps) {
  const { form, problems, status, error, document } = props;
  const { t, i18n } = useLingui();
  const format = useFormatters();

  if (status === 'sent')
    return (
      <div
        data-slot="share-template"
        data-status="sent"
        className={cn('flex flex-col items-start gap-4', props.className)}
      >
        <p role="status" className="m-0 flex max-w-prose items-start gap-2 text-md text-ink">
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-strong" />
          {t`Sent for review. It appears in the hub when a maintainer accepts it, usually within a week.`}
        </p>
        <Button onClick={props.onCancel}>{t`Done`}</Button>
      </div>
    );

  const reason =
    status === 'checking'
      ? t`Checking what would be sent.`
      : status === 'refused'
        ? t`Sharing is off for now. The line above says why.`
        : !isHandle(form.handle) || form.name.trim() === ''
          ? t`Choose your handle and a name first.`
          : problems.length > 0
            ? t`Fix the things above first.`
            : !props.acknowledged
              ? t`Tick “I understand” to share.`
              : null;
  const model = document ? previewOfStructure(document.structure) : null;

  return (
    <div data-slot="share-template" data-status={status} className={cn('@container', props.className)}>
      <div className="flex flex-col gap-6 @2xl:flex-row">
        <div className="flex w-full max-w-44 shrink-0 flex-col gap-2">
          {document && model ? (
            <>
              <StructurePreview
                mode="frame"
                structure={document.structure}
                playing
                describe={false}
                label={t`What would be shared`}
              />
              <p className="m-0 text-sm text-ink-2 tabular-nums">{structureSummary(i18n, model, format)}</p>
            </>
          ) : (
            <span aria-hidden className="tc-bone block aspect-[9/16] w-full rounded-xl bg-hover" />
          )}
        </div>
        <div className="@container flex min-w-0 flex-1 flex-col gap-6">
          {status === 'refused' && error ? <ShareRefused error={error} onFix={props.onFix} /> : null}
          <ShareLists slots={document?.structure.slots.length ?? 0} includeStyle={form.includeStyle} />
          <ShareForm
            form={form}
            onFormChange={props.onFormChange}
            problems={problems}
            languages={props.languages}
            hasLook={props.hasLook}
            disabled={status === 'sending'}
          />
          <ShareProblems checking={status === 'checking'} problems={problems} onShowSlot={props.onShowSlot} />
          <ShareSubmit
            acknowledged={props.acknowledged}
            onAcknowledge={props.onAcknowledge}
            reason={status === 'sending' ? null : reason}
            sending={status === 'sending'}
            onSubmit={props.onSubmit}
            onCancel={props.onCancel}
          />
        </div>
      </div>
    </div>
  );
}
