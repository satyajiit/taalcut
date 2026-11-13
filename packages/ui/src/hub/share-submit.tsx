// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: share submit (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the CC0 sentence as written (no softening), its "I understand" checkbox, then Submit (the
 *   dialog's one marigold) and Cancel, with why Submit is off in one line beside it
 * states: checkbox: default · hover (edge ink-3) · focus-visible (base ring) · active · checked (marigold tick,
 *   the native control) · disabled (sending) · Submit: default · hover · focus-visible · active · disabled (with the
 *   reason) · loading ("Sending") · error (the dialog's error line above) · success (the sent state replaces it)
 */
import { useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { Button } from '../components/button';

export interface ShareSubmitProps {
  readonly acknowledged: boolean;
  onAcknowledge(acknowledged: boolean): void;
  /** Why Submit is off, in one line; null when it can go. */
  readonly reason: string | null;
  readonly sending: boolean;
  onSubmit(): void;
  onCancel(): void;
}

export function ShareSubmit({
  acknowledged,
  onAcknowledge,
  reason,
  sending,
  onSubmit,
  onCancel,
}: ShareSubmitProps) {
  const { t } = useLingui();
  const checkId = useId();
  const reasonId = useId();
  return (
    <div data-slot="share-submit" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="m-0 max-w-prose text-sm text-ink">
          {t`Anyone can use, change and share this template without asking or crediting you. You can’t take that back.`}
        </p>
        <label
          htmlFor={checkId}
          className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium text-ink"
        >
          <input
            id={checkId}
            type="checkbox"
            checked={acknowledged}
            disabled={sending}
            onChange={(event) => onAcknowledge(event.target.checked)}
            className="size-4 cursor-pointer accent-primary-strong disabled:cursor-not-allowed"
          />
          {t`I understand`}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={reason !== null && !sending}
          loading={sending}
          onClick={onSubmit}
          aria-describedby={reason ? reasonId : undefined}
        >
          {sending ? t`Sending` : t`Submit for review`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={sending}>
          {t`Cancel`}
        </Button>
        {reason ? (
          <p id={reasonId} data-slot="share-reason" className="m-0 text-sm text-ink-2">
            {reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}
