// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium thanks · what the billing service says about the payment the visitor just made
 * mode: Read · system: WEB2 Remix Vernacular (one reel-cornered panel: an icon in a sticker tile, the state's heading
 *   and words, then the address)
 * states: checking (the server HTML; a spinner) · paid (the amount, what happens next, the day the plan is active by
 *   and the order's reference) · pending (asked again a few times by itself, then says it can take a minute and offers
 *   Check again) · expired · cancelled (nothing was charged; the way back to /premium/) · missing (the page was opened
 *   without a payment's values) · refused (the service couldn't match them) · unreachable (the service didn't answer;
 *   Check again) · without JavaScript: the checking words hide, and one line says the check needs it
 * The five values the payment provider put in the address are read once and then taken out of it, before the page is
 * counted as a visit: a payment's reference numbers never reach the analytics service. A paid outcome (the service's
 * own answer, nothing more) is kept in session storage, so a reload of the cleaned address still shows it until the
 * tab closes; opened with no values and nothing kept, the page says there is nothing to check. Nothing personal is shown: the
 * service answers with the plan, the amount and the dates only. A polite live region, so each change is said. */

import { CircleCheck, CircleX, Hourglass, type LucideIcon, SearchX, TimerOff, WifiOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { FORM_ICONS } from '#components/contact/form-icons';
import { InlineText } from '#components/content/inline-text';
import { Button } from '#components/ui/button';
import { buttonClasses } from '#components/ui/button-classes';
import { PREMIUM, THANKS } from '#content/premium';
import type { ConfirmRequest, Confirmation } from '#lib/billing/api';
import { type BillingClient, createBillingClient } from '#lib/billing/client';
import { dayWords, money } from '#lib/billing/money';
import { returnValues } from '#lib/billing/order';
import { rememberOutcome, rememberedOutcome } from '#lib/billing/outcome';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { RefLink } from './ref-link';

export type ThanksState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'paid'; readonly order: Confirmation }
  | { readonly kind: 'pending' | 'expired' | 'cancelled' | 'missing' | 'refused' | 'unreachable' };

/** A payment that hasn't reached the service yet is asked about this many times, this far apart, before the page says so. */
export const PENDING_TRIES = 4;
export const PENDING_GAP_MS = 2500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One answer from the service as the page's state; `pending` means ask again. */
export async function confirmOnce(client: BillingClient, values: ConfirmRequest): Promise<ThanksState> {
  const result = await client.confirm(values);
  if (!result.ok)
    return {
      kind:
        result.failure.kind === 'invalid' || result.failure.kind === 'not-found' ? 'refused' : 'unreachable',
    };
  return result.value.status === 'paid'
    ? { kind: 'paid', order: result.value }
    : { kind: result.value.status };
}

const TILES: Readonly<Record<ThanksState['kind'], readonly [icon: LucideIcon, face: string]>> = {
  checking: [FORM_ICONS.spinner, 'bg-sticker-paper text-sticker-paper-ink'],
  paid: [CircleCheck, 'bg-sticker-lime text-sticker-lime-ink'],
  pending: [Hourglass, 'bg-sticker-sky text-sticker-sky-ink'],
  expired: [TimerOff, 'bg-sticker-paper text-sticker-paper-ink'],
  cancelled: [CircleX, 'bg-sticker-paper text-sticker-paper-ink'],
  missing: [SearchX, 'bg-sticker-paper text-sticker-paper-ink'],
  refused: [SearchX, 'bg-sticker-pink text-sticker-pink-ink'],
  unreachable: [WifiOff, 'bg-sticker-violet text-sticker-violet-ink'],
};

function Words({ heading, children }: { readonly heading: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 type-site-headline text-balance text-ink">{heading}</h2>
      {children}
    </div>
  );
}

const BODY = 'm-0 max-w-[36em] type-site-body text-pretty text-ink-2';

/** Without JavaScript: no state to show, and the row under it starts at the panel's edge. */
const NO_SCRIPT_STYLE =
  '[data-slot="premium-thanks"] [role="status"]{display:none!important}[data-slot="thanks-actions"]{margin-top:0!important;padding-inline-start:0!important}';

/** The day a plan is active by is said as the billing service's own email says it: the UTC day, one date for both. */
const ACTIVE_BY_ZONE = 'UTC';

function Paid({ order }: { readonly order: Confirmation }) {
  const steps = [
    ...THANKS.paid.next,
    order.activateBy ? THANKS.paid.activeBy(dayWords(order.activateBy, ACTIVE_BY_ZONE)) : null,
  ].filter((s): s is string => s !== null);
  return (
    <Words heading={THANKS.paid.heading}>
      <p className={cn(BODY, 'text-ink')}>{THANKS.paid.line(money(order.amount, order.currency))}</p>
      <h3 className="m-0 mt-4 type-site-subhead text-ink">{THANKS.paid.nextHeading}</h3>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-grid size-8 shrink-0 -rotate-3 place-items-center rounded-pill bg-sticker-paper type-sticker text-sticker-paper-ink shadow-sticker"
            >
              {i + 1}
            </span>
            <span className={cn(BODY, 'pt-1')}>{step}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-2 max-w-[36em] type-body text-pretty text-ink-2">{THANKS.paid.emails}</p>
      <p className="m-0 type-body text-ink-2">
        {THANKS.paid.reference}:{' '}
        <code className="font-mono text-ink [overflow-wrap:anywhere]">{order.orderId}</code>
      </p>
    </Words>
  );
}

export function ThanksStatus({ client: given }: { readonly client?: BillingClient }) {
  const [state, setState] = useState<ThanksState>({ kind: 'checking' });
  const values = useRef<ConfirmRequest | null>(null);
  const run = useRef(0);

  const check = useCallback(
    async (payment: ConfirmRequest) => {
      const mine = ++run.current;
      const client = given ?? createBillingClient();
      for (let tried = 1; tried <= PENDING_TRIES; tried += 1) {
        const next = await confirmOnce(client, payment);
        if (run.current !== mine) return;
        if (next.kind !== 'pending' || tried === PENDING_TRIES) {
          // A confirmed payment is kept for the tab, so a reload (the address no longer has its values) still shows it.
          if (next.kind === 'paid') rememberOutcome(next.order);
          setState(next);
          return;
        }
        await wait(PENDING_GAP_MS);
        if (run.current !== mine) return;
      }
    },
    [given],
  );

  useEffect(() => {
    // Read once: a second run of this effect finds the address already cleared.
    const payment = values.current ?? returnValues(window.location.search);
    // Out of the address before anything counts this page: the values stay in this component only.
    if (window.location.search !== '') window.history.replaceState(null, '', window.location.pathname);
    values.current = payment;
    // Without a payment's values: the outcome this tab already confirmed, or nothing to check.
    const settle = payment
      ? check(payment)
      : Promise.resolve().then(() => {
          const order = rememberedOutcome();
          setState(order ? { kind: 'paid', order } : { kind: 'missing' });
        });
    void settle;
    return () => {
      run.current += 1;
    };
  }, [check]);

  const again = () => {
    if (!values.current) return;
    setState({ kind: 'checking' });
    void check(values.current);
  };

  const [Icon, face] = TILES[state.kind];
  const retry = state.kind === 'pending' || state.kind === 'unreachable';
  const back = state.kind === 'expired' || state.kind === 'cancelled' || state.kind === 'missing';
  return (
    <div
      data-slot="premium-thanks"
      data-state={state.kind}
      className="relative rounded-reel bg-panel px-5 py-10 sm:px-10 lg:px-14 lg:py-14"
    >
      {/* Without JavaScript nothing can be checked: the checking words hide, and one line says so before the address. */}
      <noscript>
        <style>{NO_SCRIPT_STYLE}</style>
        <p className="m-0 mb-6 max-w-[36em] type-site-body text-pretty text-ink">{THANKS.noScript}</p>
      </noscript>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[auto_minmax(0,1fr)]"
      >
        <span
          aria-hidden
          className={cn(
            'inline-grid size-14 shrink-0 -rotate-3 place-items-center rounded-2xl shadow-sticker',
            face,
          )}
        >
          <Icon
            strokeWidth={ICON_STROKE}
            className={cn('size-7', state.kind === 'checking' ? 'animate-spin' : '')}
          />
        </span>
        {state.kind === 'paid' ? (
          <Paid order={state.order} />
        ) : (
          <Words heading={THANKS[state.kind].heading}>
            <p className={BODY}>{THANKS[state.kind].body}</p>
          </Words>
        )}
      </div>
      <div
        data-slot="thanks-actions"
        className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 sm:ps-[5.5rem]"
      >
        {retry ? (
          <Button variant="secondary" size="lg" onClick={again}>
            {THANKS.checkAgain}
          </Button>
        ) : null}
        {back ? (
          <RefLink href={PREMIUM.path} className={buttonClasses('secondary', 'lg')}>
            {THANKS.back}
          </RefLink>
        ) : null}
        <p className="m-0 type-body text-ink-2">
          <InlineText text={THANKS.write} />
        </p>
      </div>
    </div>
  );
}
