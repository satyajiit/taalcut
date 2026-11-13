// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: answer failure line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 ("Errors": the cause and one fix, in one line) · a decision card's failed answer stays on the
 *   card: the kit's ErrorLine with Try again, which sends the same answer again
 * states: error (the cause and Try again) · loading (the card's own button while it sends again) · success (the line
 *   goes; the card settles when the agent re-sends it) · the button carries the eight states (ErrorLine's Button) */

import type { QuestionAnswer, TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCardActions, type ApprovalDecision, type DecideOutcome } from './card-actions';
import { ErrorLine } from './error-line';

export interface DecideOptions {
  readonly remember?: boolean;
  readonly answer?: QuestionAnswer;
}

/** A failed answer: its cause, and a way to send the same answer again. */
export interface AnswerFailure {
  readonly error: TaalcutError;
  readonly retry: () => void;
  /** Counts failures, so a second one with the same words still starts a fresh line. */
  readonly round: number;
}

export interface Answering<K extends string> {
  /** decide is there, so this card can be answered here. */
  readonly canAnswer: boolean;
  /** The answer on its way, if any. */
  readonly pending: K | null;
  /** The last answer failed: the card stays open and shows it under its actions. */
  readonly failure: AnswerFailure | null;
  /**
   * Sends one answer. Resolves with how it went (`answered`, or `closed` when the run had ended: the chat says so
   * and the card expires) or null when it failed or can't be sent here.
   */
  send(
    key: K,
    approvalId: string,
    decision: ApprovalDecision,
    options?: DecideOptions,
  ): Promise<DecideOutcome | null>;
  /** Forgets a shown failure (another answer started a step of its own, say). */
  clear(): void;
}

/**
 * A decision card's answer (UX round 1): which one is on its way, and a failure kept on the card with Try again
 * instead of a toast, so a failed answer never reads as settled. `open`: the card still asks. Once it has settled
 * another way (a new message answered "Not now", the run ended) an old failure has nothing left to retry, so it goes.
 */
export function useAnswer<K extends string>(open = true): Answering<K> {
  const { decide } = useCardActions();
  const [pending, setPending] = useState<K | null>(null);
  const [failure, setFailure] = useState<AnswerFailure | null>(null);
  const rounds = useRef(0);
  const send = useCallback<Answering<K>['send']>(
    async (key, approvalId, decision, options) => {
      if (!decide) return null;
      setPending(key);
      setFailure(null);
      const result = await (options ? decide(approvalId, decision, options) : decide(approvalId, decision));
      setPending(null);
      if (result.ok) return result.value;
      rounds.current += 1;
      setFailure({
        error: result.error,
        round: rounds.current,
        retry: () => void send(key, approvalId, decision, options),
      });
      return null;
    },
    [decide],
  );
  const clear = useCallback(() => setFailure(null), []);
  useEffect(() => {
    if (!open) setFailure(null);
  }, [open]);
  return { canAnswer: Boolean(decide), pending, failure: open ? failure : null, send, clear };
}

/**
 * The failed answer's line, under the card's actions. Sending an answer again is always safe (the run asks once),
 * so Try again shows even when the cause isn't marked retryable.
 */
export function AnswerFailureLine({ failure }: { failure: AnswerFailure | null }) {
  const { runFix, report, developerMode } = useCardActions();
  if (!failure) return null;
  return (
    <ErrorLine
      key={failure.round}
      error={{ ...failure.error, retryable: true }}
      onRetry={failure.retry}
      {...(runFix ? { onFix: runFix } : {})}
      onReport={report}
      showDetail={developerMode === true}
    />
  );
}
