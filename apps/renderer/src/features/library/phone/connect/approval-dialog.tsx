// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a phone asking to pair (UX3) · genre: atmospheric studio app · system: DESIGN.md v0.6
 * a modal over whatever is on screen while the session is open: the question with the phone's name, one sentence on
 *   why it asks, the two digits the phone shows too (JetBrains Mono, as the PIN), the phone's address quiet under
 *   them; Deny (secondary) and Allow (the one primary). Deny has the focus, so a stray Return never lets a phone in;
 *   Escape, the close button and a click outside are Deny too.
 * states: asking · answering (the chosen button spins, the other waits) · the answer failed (the cause, Try again
 *   when it can help) · gone by itself (the request lapsed or the phone stopped asking: it closes, and the
 *   connection line says so)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError, TransferApproval } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorLine,
  UserContent,
} from '@taalcut/ui';
import { useRef, useState } from 'react';
import type { TransferSessionApi } from '../use-transfer-session';

type Session = Pick<TransferSessionApi, 'approval' | 'session' | 'answerApproval'>;

/** The request a person can answer now: still pending, while the session that got it listens. */
function askingNow({ approval, session }: Pick<Session, 'approval' | 'session'>): TransferApproval | null {
  return approval?.state === 'pending' && session?.state === 'listening' ? approval : null;
}

function Asking({
  approval,
  sending,
  failed,
  onAnswer,
}: {
  approval: TransferApproval;
  /** The answer on its way: true for Allow, false for Deny. */
  sending: boolean | null;
  failed: { allow: boolean; error: TaalcutError } | null;
  onAnswer: (allow: boolean) => void;
}) {
  const { t } = useLingui();
  const deny = useRef<HTMLButtonElement>(null);
  const name = <UserContent translate="no">{approval.device.label}</UserContent>;
  const address = (
    <span translate="no" className="font-mono tabular-nums">
      {approval.address}
    </span>
  );
  return (
    <DialogContent
      data-slot="approval-dialog"
      className="max-w-md"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        deny.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          <Trans>Allow {name} to send videos?</Trans>
        </DialogTitle>
        {/* All of it is the description, so a screen reader reads the number and the address on opening too. */}
        <DialogDescription asChild>
          <div className="flex flex-col gap-4">
            <p className="m-0">
              {t`A phone on your network opened this computer’s QR code. Allow it only if it’s yours.`}
            </p>
            <p className="m-0 flex flex-col gap-2">
              <span>{t`Your phone shows the same number:`}</span>
              <span
                data-slot="match-code"
                translate="no"
                className="font-mono text-[2.5rem] leading-none font-medium tracking-[0.12em] text-ink tabular-nums"
              >
                {approval.matchCode}
              </span>
            </p>
            <p className="m-0 type-meta text-ink-3">
              <Trans>The phone’s address: {address}</Trans>
            </p>
          </div>
        </DialogDescription>
      </DialogHeader>
      {failed ? (
        <ErrorLine key={failed.error.code} error={failed.error} onRetry={() => onAnswer(failed.allow)} />
      ) : null}
      <DialogFooter>
        <Button
          ref={deny}
          variant="secondary"
          loading={sending === false}
          disabled={sending === true}
          onClick={() => onAnswer(false)}
        >
          {t`Deny`}
        </Button>
        <Button
          variant="primary"
          loading={sending === true}
          disabled={sending === false}
          onClick={() => onAnswer(true)}
        >
          {t`Allow`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Asks the person on the computer whether the phone that opened the QR's link may pair (UX3): shown by whatever holds
 * the session (the phone flow, first run's Wi-Fi way, the chat's phone panel), over whatever is on screen. Only Allow
 * lets the phone in; every other way out is Deny. It closes once the answer is in, or by itself when the request
 * lapses or the phone stops asking.
 */
export function ApprovalDialog({ transfer }: { transfer: Session }) {
  const asking = askingNow(transfer);
  // Kept while the dialog fades out, so it leaves with its words.
  const [shown, setShown] = useState(asking);
  const [sending, setSending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<{ allow: boolean; error: TaalcutError } | null>(null);
  /** One answer at a time: a second Escape while Deny is on its way sends nothing more. */
  const busy = useRef(false);
  if (asking && asking !== shown) {
    // A new request starts with nothing sent and nothing failed.
    if (asking.id !== shown?.id) {
      setSending(null);
      setFailed(null);
    }
    setShown(asking);
  }

  const answer = (allow: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSending(allow);
    setFailed(null);
    void transfer.answerApproval(allow).then((result) => {
      busy.current = false;
      setSending(null);
      if (result && !result.ok) setFailed({ allow, error: result.error });
    });
  };

  return (
    <Dialog open={asking !== null} onOpenChange={(open) => (open ? undefined : answer(false))}>
      {shown ? (
        <Asking key={shown.id} approval={shown} sending={sending} failed={failed} onAnswer={answer} />
      ) : null}
    </Dialog>
  );
}
