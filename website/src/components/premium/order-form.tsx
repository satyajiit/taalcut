// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium order form · who is ordering and where to reach them, then on to the payment page
 * mode: Persuade · system: WEB2 Remix Vernacular · DESIGN.md (Inputs and choices, Buttons, Feedback): the contact
 *   form's own parts (form-parts.tsx)
 * states: default · a field: hover · focus · error (its line under it, aria-invalid, focus moves to the first) ·
 *   read-only while the order is sent · the box: unticked · ticked · error · the button: default · hover · focus ·
 *   active · loading ("Checking the price…" while the first quote is still out, then "Opening the payment page…",
 *   which stays while the browser leaves) · a refusal: one line under the button, with Try again where trying again is
 *   the fix · a changed price: the price line above says the new one and the line asks to continue · closed (orders
 *   off, or the billing service out of reach): the form gives way to one sentence and the address · success: the
 *   browser goes to the payment page, and comes back to /premium/thanks/
 * The fields carry no `name`, so a send before the script runs puts nothing in the address. The terms open in a new
 * tab: reading them must not empty the form. The name, the email and the WhatsApp number are required (the payment
 * provider makes no payment page without a phone number, and a line under that field says so); only the channel is
 * tagged Optional. */

import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef } from 'react';
import {
  FIELD,
  FieldLabel,
  MessageSlot,
  RetryButton,
  StatusLine,
  SubmitButton,
} from '#components/contact/form-parts';
import { InlineText, INLINE_LINK_CLASS } from '#components/content/inline-text';
import { emailHint } from '#content/forms';
import { ORDER } from '#content/premium';
import { waitWords } from '#lib/billing/money';
import type { OrderField, OrderProblem } from '#lib/billing/order';
import { usePremiumQuote } from './quote-context';
import { type OrderNotice, useOrder } from './use-order';

/** A field's problem in words: the cause and its one fix. */
export function problemWords(found: OrderProblem, email: string): string {
  if (found.problem === 'refused') return ORDER.problems.field;
  switch (found.field) {
    case 'name':
      return found.problem === 'empty'
        ? ORDER.problems.nameEmpty
        : found.problem === 'too-short'
          ? ORDER.problems.nameShort
          : ORDER.problems.nameLong;
    case 'email':
      return found.problem === 'characters' ? ORDER.problems.emailChars : emailHint(email, found.problem);
    case 'whatsapp':
      return found.problem === 'empty' ? ORDER.problems.whatsappEmpty : ORDER.problems.whatsapp;
    case 'channel':
      return found.problem === 'too-long' ? ORDER.problems.channelLong : ORDER.problems.channel;
    case 'agreed':
      return ORDER.problems.agree;
  }
}

/** A refusal in words: the service's own wait where it names one. The words may carry the address as a link. */
export function noticeWords({ failure }: OrderNotice): string {
  if (failure.kind === 'rate-limited' && failure.retryAfterSeconds)
    return ORDER.rateLimitedFor(waitWords(failure.retryAfterSeconds));
  // Orders off, or a page the service refuses: these never reach a line, because the form closes instead.
  if (failure.kind === 'not-selling' || failure.kind === 'forbidden') return ORDER.closed;
  return ORDER.refusals[failure.kind];
}

/** Content text whose links open in a new tab, so following one keeps what the form holds. */
function NewTabText({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <a key={at} href={m[2]} target="_blank" rel="noopener" className={INLINE_LINK_CLASS}>
        {m[1]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Shown in place of the form: orders are off here, and the address takes them. */
export function OrderClosed() {
  return (
    <p
      data-slot="order-closed"
      role="status"
      className="m-0 max-w-[34em] type-site-body text-pretty text-ink"
    >
      <InlineText text={ORDER.closed} />
    </p>
  );
}

export function OrderForm({ labelledBy }: { readonly labelledBy: string }) {
  const { state } = usePremiumQuote();
  const id = useId();
  const name = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const whatsapp = useRef<HTMLInputElement>(null);
  const channel = useRef<HTMLInputElement>(null);
  const agreedBox = useRef<HTMLInputElement>(null);
  const refs: Readonly<Record<OrderField, RefObject<HTMLInputElement | null>>> = useMemo(
    () => ({ name, email, whatsapp, channel, agreed: agreedBox }),
    [name, email, whatsapp, channel, agreedBox],
  );
  const { answers, update, send, status, problems, notice, rest } = useOrder(refs, (payUrl) =>
    window.location.assign(payUrl),
  );
  // Coming back from the payment page through the browser's cache: the button is no longer leaving.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) rest();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [rest]);

  if (state.status === 'closed') return <OrderClosed />;

  const busy = status !== 'idle';
  const found = (field: OrderField) => problems.find((p) => p.field === field);
  const text = (
    field: Exclude<OrderField, 'agreed'>,
    label: string,
    input: {
      type: string;
      inputMode?: 'email' | 'tel' | 'url';
      autoComplete: string;
      hint?: string;
      /** A line that stays under the field's message: why the form asks. */
      why?: string;
      optional?: boolean;
    },
  ) => {
    const problem = found(field);
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor={`${id}-${field}`} note={input.optional ? ORDER.optional : undefined}>
          {label}
        </FieldLabel>
        <input
          id={`${id}-${field}`}
          ref={refs[field]}
          type={input.type}
          inputMode={input.inputMode}
          autoComplete={input.autoComplete}
          autoCapitalize={field === 'name' ? 'words' : 'none'}
          spellCheck={false}
          value={answers[field]}
          readOnly={busy}
          required={!input.optional}
          aria-required={!input.optional}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-${field}-says`}
          onChange={(e) => update(field, e.target.value)}
          className={FIELD}
        />
        <MessageSlot id={`${id}-${field}-says`}>
          {problem ? (
            <StatusLine tone="error">{problemWords(problem, answers.email)}</StatusLine>
          ) : input.hint ? (
            <span className="type-meta text-ink-2">{input.hint}</span>
          ) : null}
        </MessageSlot>
        {input.why ? <p className="m-0 type-meta text-pretty text-ink-2">{input.why}</p> : null}
      </div>
    );
  };
  const agreed = found('agreed');

  return (
    <form
      noValidate
      aria-labelledby={labelledBy}
      data-slot="order-form"
      data-status={status}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        {text('name', ORDER.name, { type: 'text', autoComplete: 'name' })}
        {text('email', ORDER.email, { type: 'email', inputMode: 'email', autoComplete: 'email' })}
        {text('whatsapp', ORDER.whatsapp, {
          type: 'tel',
          inputMode: 'tel',
          autoComplete: 'tel',
          hint: ORDER.whatsappHint,
          why: ORDER.whatsappWhy,
        })}
        {text('channel', ORDER.channel, {
          type: 'text',
          inputMode: 'url',
          autoComplete: 'url',
          hint: ORDER.channelHint,
          optional: true,
        })}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <input
            id={`${id}-agreed`}
            ref={refs.agreed}
            type="checkbox"
            checked={answers.agreed}
            disabled={busy}
            required
            aria-required
            aria-invalid={agreed ? true : undefined}
            aria-describedby={`${id}-agreed-says`}
            onChange={(e) => update('agreed', e.target.checked)}
            className="mt-px size-6 shrink-0 cursor-pointer rounded-md accent-ink disabled:cursor-not-allowed"
          />
          <label htmlFor={`${id}-agreed`} className="min-w-0 type-body text-pretty text-ink">
            <NewTabText text={ORDER.agree} />
          </label>
        </div>
        <MessageSlot id={`${id}-agreed-says`}>
          {agreed ? <StatusLine tone="error">{problemWords(agreed, answers.email)}</StatusLine> : null}
        </MessageSlot>
      </div>
      <div className="flex flex-col gap-3">
        <SubmitButton
          busy={busy}
          label={ORDER.submit}
          busyLabel={status === 'pricing' ? ORDER.pricing : ORDER.submitting}
          className="self-start max-sm:w-full"
        />
        <MessageSlot>
          {notice ? (
            <StatusLine
              tone={notice.failure.kind === 'offline' ? 'offline' : 'error'}
              alert
              action={
                notice.retry ? <RetryButton label={ORDER.tryAgain} onClick={() => void send()} /> : undefined
              }
            >
              <InlineText text={noticeWords(notice)} />
            </StatusLine>
          ) : null}
        </MessageSlot>
      </div>
      <p className="m-0 type-meta text-ink-2">
        <NewTabText text={ORDER.privacy} />
      </p>
    </form>
  );
}
