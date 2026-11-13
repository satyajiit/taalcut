// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: report dialog (/templates/hub/$hubId) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · Report… asks why (a radio list, each reason with its line), an optional note, and sends
 *   hub.report (a person's action); then "Thanks. A maintainer will look at it."
 * states: Report…: default · hover · focus-visible · active (ghost Button) · radios: default · hover · focus-visible
 *   (base ring) · checked · disabled (while sending) · Send: disabled until a reason is picked (said why) · loading
 *   ("Sending") · error (the cause above the buttons, with its fix) · success (the thanks, Done)
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  HUB_COMMANDS,
  HUB_REPORT_REASONS,
  type HubReportReason,
  type HubTemplateId,
  type TaalcutError,
} from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ErrorLine,
} from '@taalcut/ui';
import { CircleCheck, Flag } from 'lucide-react';
import { useId, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { REPORT_REASONS } from './hub-words';
import { noteHubRefusal } from './hub-limits';

export function ReportDialog({ hubId }: { readonly hubId: HubTemplateId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HubReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setReason(null);
      setNote('');
      setSent(false);
      setError(null);
    }
  };
  const send = async () => {
    if (!reason) return;
    setSending(true);
    setError(null);
    const trimmed = note.trim();
    const done = await callRpc(
      backend.commands.dispatch({
        name: HUB_COMMANDS.report,
        payload: { projectId: null, hubId, reason, ...(trimmed ? { note: trimmed } : {}) },
        source: 'ui',
      }),
    );
    setSending(false);
    if (done.ok) setSent(true);
    else {
      noteHubRefusal(done.error);
      setError(done.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Flag aria-hidden />
          {t`Report…`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t`Report this template`}</DialogTitle>
          <DialogDescription>
            {t`A maintainer reads every report. Only the template’s hub id goes with it, never anything about you.`}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <>
            <p role="status" className="m-0 flex items-center gap-2 text-md text-ink">
              <CircleCheck aria-hidden className="size-5 shrink-0 text-success-strong" />
              {t`Thanks. A maintainer will look at it.`}
            </p>
            <DialogFooter>
              <Button onClick={() => reset(false)}>{t`Done`}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={sending}>
              <legend className="mb-2 text-sm font-medium text-ink">{t`What’s wrong with it?`}</legend>
              {HUB_REPORT_REASONS.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-hover has-[:disabled]:cursor-not-allowed"
                >
                  <input
                    type="radio"
                    name="hub-report-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="mt-1 size-4 cursor-pointer accent-primary-strong"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm text-ink">{i18n._(REPORT_REASONS[value].label)}</span>
                    <span className="text-sm text-ink-3">{i18n._(REPORT_REASONS[value].hint)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-sm font-medium text-ink">
                {t`Note (optional)`}
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={500}
                rows={3}
                disabled={sending}
                onChange={(event) => setNote(event.target.value)}
                className="w-full resize-none rounded-md border border-rule-strong bg-raised px-3 py-2 text-base text-ink shadow-xs hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas disabled:bg-sunken disabled:text-ink-disabled"
              />
            </div>
            {error ? <ErrorLine error={error} /> : null}
            <DialogFooter>
              {!reason ? (
                <span className="me-auto text-sm text-ink-2">{t`Pick a reason to send it.`}</span>
              ) : null}
              <Button variant="ghost" onClick={() => reset(false)} disabled={sending}>
                {t`Cancel`}
              </Button>
              <Button disabled={!reason} loading={sending} onClick={() => void send()}>
                {sending ? t`Sending` : t`Send report`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
