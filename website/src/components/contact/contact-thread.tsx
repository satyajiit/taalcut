// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: contact thread · /contact/ as a direct-message thread with Taalcut
 * mode: Persuade · system: WEB2 Remix Vernacular (the direct message: paired avatars, a Stories question sticker that
 *   opens it, bubbles, one-line replies, the composer at the thread's foot, a receipt under what you sent)
 * states: opening (on a full load with motion allowed, Taalcut types, its question sticker pops in and settles, then
 *   its answers, the topic chips, pop in) · idle · topic picked (your bubble, Taalcut types, its answer) · focus
 *   (Kaatu glances) · answered (Return, or moving on with a good name or address: your bubble, Change under it) ·
 *   invalid (each field's cause and fix in its slot, focus to the first; nothing moves) · sending (your bubble posts
 *   with "Sending…"; Kaatu thinks) · sent ("Sent" with a tick, Taalcut's thanks, announced and focused; Kaatu
 *   cheers) · not sent (under your bubble: the cause, with Try again where that's the fix; offline says so; Kaatu
 *   oops) · closed (no Firebase config: the fields and Send are disabled, Taalcut says where to write instead, and
 *   each topic answers with its mailbox; Kaatu sleeps) · without JavaScript (every word, the addresses on the page, a
 *   line that the form needs JavaScript) · reduced motion (no typing, no pops: 150 ms fades)
 * The thread grows with the page and has no scroll of its own, so nothing ever sits behind the composer: the composer
 *   is the thread's foot, and the page scrolls. It is a real <form> writing `contact/{auto}` to Firestore
 *   (lib/firebase), loaded on the first field's focus. */

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import type { KaatuMood, KaatuPose } from '#components/kaatu/kaatu';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { RetryButton, StatusLine } from '#components/contact/form-parts';
import { CONTACT_PAGE, type ContactChipId } from '#content/contact';
import { causeRetries, causeWords, CONTACT_WORDS, emailHint } from '#content/forms';
import { cn } from '#lib/cn';
import { normalizeEmail } from '#lib/email';
import { FIREBASE_SETUP, FORMS_OPEN } from '#lib/firebase/config';
import type { ContactField, ContactProblem } from '#lib/firebase/entries';
import { preloadFirebase } from '#lib/firebase/load';
import { QuestionSticker } from './question-sticker';
import { Bubble, Receipt, ThreadHeader, TypingBubble } from './thread-parts';
import { ClosedBubble, TopicReply } from './thread-replies';
import { Answer, Composer, EMAIL_ICON, NAME_ICON, REPLY_CLASS, ReplyField } from './thread-form';
import { chipById, chipFromSearch } from './topics';
import { fieldProblem, useContactSend } from './use-contact-send';
import { INTRO_SCRIPT, introShows, useThreadIntro } from './use-thread-intro';

/** How long Taalcut types before its answer to a topic. */
const TYPING_MS = 750;

/** The two things Taalcut asks before the message: each is answered in one line. */
type Asked = 'name' | 'email';
const ASKED: Readonly<Record<Asked, { readonly label: string; readonly question: string }>> = {
  name: { label: CONTACT_WORDS.nameLabel, question: CONTACT_PAGE.thread.askName },
  email: { label: CONTACT_WORDS.emailLabel, question: CONTACT_PAGE.thread.askEmail },
};
const KIND = {
  name: { type: 'text', autoComplete: 'name', icon: NAME_ICON },
  email: { type: 'email', autoComplete: 'email', icon: EMAIL_ICON, inputMode: 'email', autoCapitalize: 'none' },
} as const;

function problemWords(field: ContactField, problem: ContactProblem, email: string): string {
  if (field === 'email') return emailHint(email, problem);
  if (field === 'name') return problem === 'empty' ? CONTACT_WORDS.nameEmpty : CONTACT_WORDS.nameLong;
  return problem === 'empty' ? CONTACT_WORDS.messageEmpty : CONTACT_WORDS.messageLong;
}

/** Brings `el` into view on the page if it isn't, with the least scroll that does. */
function reveal(el: Element | null | undefined, reduce: boolean) {
  el?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

export function ContactThread({ className }: { readonly className?: string }) {
  const id = useId();
  const reduce = useReducedMotionPref();
  const logRef = useRef<HTMLDivElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const fields = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
  };
  const intro = useThreadIntro(logRef);
  const [chip, setChip] = useState<ContactChipId | null>(null);
  /** The topic whose answer has landed (Taalcut typed it). */
  const [replied, setReplied] = useState<ContactChipId | null>(null);
  /** The replies you've answered: each shows as your bubble until you change it. */
  const [answered, setAnswered] = useState<Readonly<Record<Asked, boolean>>>({ name: false, email: false });
  const [focused, setFocused] = useState(false);
  const typing = useRef<number | undefined>(undefined);
  const sentHere = useRef(false);
  const pickedHere = useRef(false);
  const { values, update, send, check, reset, status, problems, cause, posted } = useContactSend({ chip, fields });
  const busy = status === 'submitting';

  const pick = useCallback(
    (next: ContactChipId, now = false) => {
      setChip(next);
      window.clearTimeout(typing.current);
      if (now || reduce) {
        setReplied(next);
        return;
      }
      setReplied(null);
      typing.current = window.setTimeout(() => setReplied(next), TYPING_MS);
    },
    [reduce],
  );
  useEffect(() => () => window.clearTimeout(typing.current), []);
  const choose = (next: ContactChipId) => {
    pickedHere.current = true;
    pick(next);
  };

  // `?topic=privacy` (the privacy page's link) picks that topic, answered at once.
  useEffect(() => {
    const asked = chipFromSearch(window.location.search);
    if (asked) pick(asked, true);
  }, [pick]);

  // Keep what you just did in view on the page: the topic you picked and Taalcut's answer, the message you posted.
  const pair = useRef<HTMLDivElement>(null);
  const postedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pickedHere.current) reveal(pair.current, reduce);
  }, [chip, replied, reduce]);
  useEffect(() => {
    if (posted !== null) reveal(postedRef.current, reduce);
  }, [posted, status, reduce]);

  // A send that stopped on your name or address shows that reply whole, its problem line too, not only the field.
  useEffect(() => {
    if (status !== 'invalid') return;
    const first = (['name', 'email'] as const).find((f) => problems[f]);
    if (first) reveal(fields[first].current?.closest('[data-slot="reply"]'), reduce);
  }, [status, problems, reduce]);

  // A sent message hands focus to Taalcut's thanks, so a keyboard user carries on from there.
  useEffect(() => {
    if (status === 'submitting') sentHere.current = true;
    if (status === 'success' && sentHere.current) thanks.current?.focus();
  }, [status]);

  /** A reply becomes your bubble. From Return, focus moves on to the next thing to write. */
  const answer = (field: Asked, moveOn: boolean) => {
    if (!moveOn) {
      setAnswered((now) => ({ ...now, [field]: true }));
      return;
    }
    flushSync(() => setAnswered((now) => ({ ...now, [field]: true })));
    (field === 'name' && !answered.email ? fields.email : fields.message).current?.focus();
  };
  /** Change: the reply opens again with your words in it, focused. */
  const reopen = (field: Asked) => {
    flushSync(() => setAnswered((now) => ({ ...now, [field]: false })));
    fields[field].current?.focus();
  };

  const onFocus = () => {
    preloadFirebase();
    setFocused(true);
  };
  const onBlur = () => setFocused(false);
  const lineFor = (field: ContactField) => {
    const problem = problems[field];
    return problem ? (
      <StatusLine tone="error">{problemWords(field, problem, values.email)}</StatusLine>
    ) : null;
  };

  const reply = (field: Asked) => {
    const fieldId = `${id}-${field}`;
    if (answered[field])
      return (
        <Answer field={field} label={ASKED[field].label} onChange={() => reopen(field)} disabled={busy}>
          {values[field].trim()}
        </Answer>
      );
    const { icon, ...kind } = KIND[field];
    return (
      <ReplyField id={fieldId} label={ASKED[field].label} icon={icon} line={lineFor(field)}>
        <input
          ref={fields[field]}
          id={fieldId}
          {...kind}
          spellCheck={field === 'email' ? false : undefined}
          enterKeyHint="next"
          placeholder={CONTACT_PAGE.thread.replyHints[field]}
          value={values[field]}
          disabled={!FORMS_OPEN}
          readOnly={busy}
          required
          onFocus={onFocus}
          onBlur={(e: FocusEvent<HTMLInputElement>) => {
            onBlur();
            // Moving on (another field, a chip, anywhere on the page) answers a good reply; leaving the window doesn't.
            if (busy || !e.currentTarget.ownerDocument.hasFocus()) return;
            if (fieldProblem(field, values) === null) answer(field, false);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            // Return answers this reply, as in a chat; it never sends the form from here. A bad answer shows its
            // problem in the reply's slot, which is always there: the reply shows whole, the problem line too.
            e.preventDefault();
            if (check(field)) answer(field, true);
            else reveal(e.currentTarget.closest('[data-slot="reply"]'), reduce);
          }}
          onChange={(e) => update(field, e.target.value)}
          aria-invalid={problems[field] ? true : undefined}
          aria-describedby={`${fieldId}-line`}
          className={REPLY_CLASS}
        />
      </ReplyField>
    );
  };

  let mood: KaatuMood = focused ? 'glance' : 'idle';
  let pose: KaatuPose | undefined;
  if (!FORMS_OPEN) mood = 'asleep';
  else if (status === 'success') pose = 'cheer';
  else if (busy) mood = 'thinking';
  else if (status === 'error' || status === 'offline' || Object.keys(problems).length > 0) mood = 'oops';

  const retry =
    posted === null ? null : <RetryButton label={CONTACT_WORDS.tryAgain} onClick={() => void send(posted)} />;
  let failure = null;
  if (status === 'offline')
    failure = (
      <StatusLine tone="offline" alert action={retry}>
        {CONTACT_WORDS.offline}
      </StatusLine>
    );
  else if (status === 'error' && cause)
    failure = (
      <StatusLine tone="error" alert action={causeRetries(cause) ? retry : null}>
        {causeWords(cause, 'Our inbox')}
      </StatusLine>
    );

  return (
    <section
      aria-labelledby="contact-form"
      data-forms={FIREBASE_SETUP.mode}
      className={cn('flex flex-col rounded-window bg-canvas shadow-window', className)}
    >
      <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      <ThreadHeader headingId="contact-form" mood={mood} pose={pose} />
      <form
        noValidate
        onSubmit={(e) => (e.preventDefault(), void send())}
        aria-busy={busy || undefined}
        className="flex flex-col"
      >
        <div
          ref={logRef}
          role="log"
          aria-label={CONTACT_PAGE.thread.log}
          className="flex flex-col gap-2.5 px-3 pt-4 pb-2 sm:px-5"
        >
          {intro === 0 ? <TypingBubble /> : null}
          <QuestionSticker
            shown={introShows(intro, 1)}
            answersShown={introShows(intro, 2)}
            picked={chip}
            onPick={choose}
          />

          {chip ? (
            <div ref={pair} className="flex flex-col gap-2.5" data-slot="topic-pair">
              <Bubble key={`you-${chip}`} side="you" pop>
                {chipById(chip).label}
              </Bubble>
              {replied === chip ? (
                <TopicReply key={`reply-${chip}`} chip={chipById(chip)} open={FORMS_OPEN} />
              ) : (
                <TypingBubble />
              )}
            </div>
          ) : null}
          {/* Closed, Taalcut says where to write instead before it asks anything, so the note comes before the
              fields it explains. */}
          {FORMS_OPEN ? null : <ClosedBubble />}

          <Bubble side="taalcut" className="mt-1">
            {ASKED.name.question}
          </Bubble>
          {reply('name')}
          <Bubble side="taalcut">{ASKED.email.question}</Bubble>
          {reply('email')}

          {posted !== null ? (
            <div ref={postedRef} className="mt-2 flex flex-col gap-2" data-slot="posted">
              <Bubble side="you" pop className="whitespace-pre-line">
                {posted}
              </Bubble>
              {busy ? <Receipt sent={false}>{CONTACT_WORDS.sending}</Receipt> : null}
              {status === 'success' ? <Receipt sent>{CONTACT_WORDS.sent}</Receipt> : null}
              {/* Two lines held for a failure, so trying again and failing another way never moves the page. */}
              {failure ? <div className="min-h-[2lh] w-full max-w-[24rem] self-end type-body">{failure}</div> : null}
            </div>
          ) : null}

          <div role="status" className="flex flex-col">
            {status === 'success' ? (
              <div
                ref={thanks}
                tabIndex={-1}
                className="flex flex-col gap-2.5 self-start rounded-[1.375rem] outline-offset-4"
              >
                <Bubble side="taalcut" pop>
                  {CONTACT_WORDS.success} {CONTACT_WORDS.successLine}{' '}
                  <span className="font-semibold">{normalizeEmail(values.email)}</span>.
                </Bubble>
              </div>
            ) : null}
          </div>
        </div>

        {status === 'success' ? (
          <div className="flex items-center justify-between gap-3 rounded-b-window border-t border-rule-subtle bg-raised px-4 py-4">
            <p className="m-0 type-meta text-ink-2">{CONTACT_PAGE.thread.status}</p>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center rounded-pill border border-rule bg-control px-4 type-label text-ink transition-colors duration-(--dur-micro) hover:bg-control-hover active:bg-control-pressed"
            >
              {CONTACT_WORDS.sendAnother}
            </button>
          </div>
        ) : (
          <Composer
            id={`${id}-message`}
            textarea={fields.message}
            value={values.message}
            onChange={(v) => update('message', v)}
            onFocus={onFocus}
            onBlur={onBlur}
            onSend={() => void send()}
            busy={busy}
            open={FORMS_OPEN}
            invalid={!!problems.message}
            line={lineFor('message')}
          />
        )}
      </form>
    </section>
  );
}
