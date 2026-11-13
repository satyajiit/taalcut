// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: waitlist form · mode: Persuade · system: WEB2 Remix Vernacular (One Marigold Rule; the field a pill with
 *   the mail glyph inside, as the decision comp draws it)
 * The contract other lanes place: <WaitlistForm variant source platform className />. Its button is the one marigold
 * fill on its screen. `inline`: the email and the button on one row (hero, band), the label for assistive technology
 * and the hint in the field. `page`: /waitlist/, every field, each label shown.
 * states: default (label, field, its empty message slot, the consent line; on /waitlist/ no platform ticked unless
 *   the address or the prop names one) · hover (field edge ink-3; button face -strong) · focus (base ring; Kaatu
 *   glances) · active (the button gives 2%) · disabled (no Firebase config: the closed state, only) · loading
 *   ("Joining…", spinner, field locked, aria-busy; Kaatu thinks) · error (the cause and its fix in the slot under
 *   the field, danger icon, ending with Try again where that's the fix; a bad address puts focus back in the field;
 *   Kaatu oops; nothing under it moves)
 *   · offline (the slot says so and ends with Try again, inline; nothing under it moves) · success (the form gives
 *   way to "You're on the list.", announced; Kaatu delighted)
 * Each form keeps its own status, problem and failure, so the hero's problem never shows in the closing band, and
 *   the Kaatu beside a form follows that form. The forms share the typed address and the joined state: a sign-up in
 *   one shows "You're on the list." in every form on the page.
 * Before the script runs the button already has its marigold face. The fields have no `name`, so a send without
 *   JavaScript reloads the page carrying nothing, and the <noscript> line says the form needs it.
 * Firebase loads on intent: the field's focus starts the download, sending waits for it (lib/firebase/load). */

import Link from 'next/link';
import { Mail } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PlatformId } from '#content/schema';
import { cn } from '#lib/cn';
import { FIREBASE_SETUP, FORMS_OPEN } from '#lib/firebase/config';
import { parsePlatform } from '#lib/firebase/entries';
import { preloadFirebase } from '#lib/firebase/load';
import { useWaitlistStore } from '#stores/waitlist';
import { FIELD_WITH_GLYPH, FieldGlyph, FieldLabel, MessageSlot, RetryButton, StatusLine, SubmitButton } from './form-parts';
import { useReportMood } from './kaatu-mood';
import { MakeSelect, PlatformChoices } from './page-fields';
import { useWaitlistSend } from './use-waitlist-send';
import { WaitlistSuccess, FollowLine } from './waitlist-success';
import { causeRetries, causeWords, emailHint, WAITLIST_WORDS } from '#content/forms';

export interface WaitlistFormProps {
  /** `inline`: the hero and the end-of-page band (email and button on one row). `page`: /waitlist with every field. */
  readonly variant?: 'inline' | 'page';
  /** Where the sign-up came from (`?ref=` or the section), stored with the entry. */
  readonly source?: string;
  /** A platform to preselect on the page form (`?platform=` in the address wins). Nothing is ticked otherwise. */
  readonly platform?: PlatformId;
  readonly className?: string;
}

export function WaitlistForm({ variant = 'inline', source, platform, className }: WaitlistFormProps) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const success = useRef<HTMLDivElement>(null);
  const email = useWaitlistStore((s) => s.email);
  const setEmail = useWaitlistStore((s) => s.setEmail);
  // The page form's platforms: none unless the prop names one, or the address does (`?platform=ubuntu`) once the
  // script runs. Joining with none ticked is fine.
  const [picked, setPicked] = useState<readonly PlatformId[]>(platform ? [platform] : []);
  const { send, status, problem, cause } = useWaitlistSend({ variant, source, platform, picked, field, success });
  const reportFocus = useReportMood(status);

  useEffect(() => {
    if (variant !== 'page') return;
    const asked = parsePlatform(new URLSearchParams(window.location.search).get('platform'));
    if (asked) setPicked([asked]);
  }, [variant]);

  const toggle = (id: PlatformId) =>
    setPicked((now) => (now.includes(id) ? now.filter((p) => p !== id) : [...now, id]));

  const page = variant === 'page';
  const busy = status === 'submitting';
  const ids = { email: `${id}-email`, line: `${id}-line`, consent: `${id}-consent` };
  const showsProblem = status === 'invalid' && problem !== null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const retry = <RetryButton label={WAITLIST_WORDS.tryAgain} onClick={() => void send()} />;

  // What the slot under the field holds: the closed state's line, or a problem, or nothing.
  let line: ReactNode = null;
  if (!FORMS_OPEN) {
    line = <FollowLine lead={WAITLIST_WORDS.closed} />;
  } else if (showsProblem) {
    line = <StatusLine tone="error">{emailHint(email, problem)}</StatusLine>;
  } else if (status === 'error' && cause) {
    line = (
      <StatusLine tone="error" alert action={causeRetries(cause) ? retry : null}>
        {causeWords(cause, 'The list')}
      </StatusLine>
    );
  } else if (status === 'offline') {
    line = (
      <StatusLine tone="offline" alert action={retry}>
        {WAITLIST_WORDS.offline}
      </StatusLine>
    );
  }

  const submit = (
    <SubmitButton
      busy={busy}
      disabled={!FORMS_OPEN}
      label={WAITLIST_WORDS.submit}
      busyLabel={WAITLIST_WORDS.submitting}
      className={cn('w-full', page ? 'sm:w-auto sm:self-start' : 'sm:w-auto')}
    />
  );

  return (
    <div
      className={cn('flex w-full flex-col', page ? 'max-w-xl' : 'max-w-md', className)}
      data-variant={variant}
      data-waitlist={FIREBASE_SETUP.mode}
    >
      {status === 'success' ? null : (
        <form
          noValidate
          onSubmit={onSubmit}
          aria-busy={busy || undefined}
          className={cn('flex flex-col', page ? 'gap-6' : 'gap-1')}
        >
          <div className="flex flex-col gap-2">
            {page ? (
              <FieldLabel htmlFor={ids.email}>{WAITLIST_WORDS.emailLabel}</FieldLabel>
            ) : (
              <label htmlFor={ids.email} className="sr-only">
                {WAITLIST_WORDS.emailLabel}
              </label>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative sm:flex-1">
                <FieldGlyph icon={Mail} />
                <input
                  ref={field}
                  id={ids.email}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint={page ? 'next' : 'send'}
                  required
                  disabled={!FORMS_OPEN}
                  readOnly={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => {
                    preloadFirebase();
                    reportFocus(true);
                  }}
                  onBlur={() => reportFocus(false)}
                  placeholder={page ? WAITLIST_WORDS.placeholder : WAITLIST_WORDS.inlineHint}
                  aria-invalid={showsProblem || undefined}
                  aria-describedby={FORMS_OPEN ? `${ids.line} ${ids.consent}` : ids.line}
                  className={FIELD_WITH_GLYPH}
                />
              </div>
              {page ? null : submit}
            </div>
            {/* Closed, the slot says so where the eye already is, under the field, not below the fold. */}
            <MessageSlot id={ids.line}>{line}</MessageSlot>
          </div>
          {page ? (
            <>
              <PlatformChoices picked={picked} onToggle={toggle} disabled={!FORMS_OPEN} />
              <MakeSelect disabled={!FORMS_OPEN} />
              {submit}
            </>
          ) : null}
          {FORMS_OPEN ? (
            <p id={ids.consent} className="m-0 type-body text-ink-2">
              {WAITLIST_WORDS.consent}{' '}
              <Link
                href="/privacy/"
                className="text-ink underline decoration-rule-strong decoration-1 underline-offset-4 transition-colors duration-(--dur-micro) hover:decoration-ink"
              >
                {WAITLIST_WORDS.privacyLink}
              </Link>
            </p>
          ) : null}
          {FORMS_OPEN ? (
            <noscript>
              <p className="m-0 type-body text-ink-2">{WAITLIST_WORDS.noScript}</p>
            </noscript>
          ) : null}
        </form>
      )}
      <div role="status">{status === 'success' ? <WaitlistSuccess ref={success} /> : null}</div>
    </div>
  );
}
