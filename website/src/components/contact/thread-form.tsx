// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: thread replies (your name and address, each asked by Taalcut and answered in one line) and the composer
 *   (the message and Send, at the thread's foot)
 * mode: Persuade · system: WEB2 Remix Vernacular (a direct message: a reply is written in the composer's style, a
 *   field on your side of the thread with its hint inside; once you answer, it becomes your teal bubble. A bubble is a
 *   message or a control, never both. Send is ink, since the page's one marigold fill is Download for Mac)
 * states: reply default (raised, rule-strong edge, its hint) · hover (edge ink-3) · focus (base ring; Kaatu glances)
 *   · read-only while sending · disabled (the closed state) · error (danger edge, aria-invalid, the cause and fix in
 *   its slot, which is always there, so nothing moves) · answered (Return, or moving on with a good answer: your
 *   bubble pops in, Change under it) · Change default (ink-2, rule-strong underline) · hover (ink, underline ink) ·
 *   focus (base ring) · disabled (while sending) · Send default (ink) · hover (ink-2) · focus (base ring) · active
 *   (gives 2%) · disabled (control face: the closed state) · loading (spinner, "Sending…", aria-busy) · shown (once
 *   the message has words, the page scrolls the least it can to show Send whole)
 * The fields have no `name`, so a send without JavaScript carries nothing; a <noscript> line says the form needs it.
 * ⌘ or Ctrl with Return sends from the message box, as in a chat. */

import { Pencil, Send, UserRound, type LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import {
  FACE,
  FIELD_WITH_GLYPH,
  FieldGlyph,
  FORM_ICONS,
  LOCKED,
  MessageSlot,
} from '#components/contact/form-parts';
import { CONTACT_PAGE } from '#content/contact';
import { CONTACT_WORDS } from '#content/forms';
import { cn } from '#lib/cn';
import { ICON_SIZE, ICON_STROKE, ICONS } from '#lib/icons';
import { CONTACT_LIMITS } from '#lib/firebase/entries';
import { Bubble } from './thread-parts';

/** Your reply to one of Taalcut's questions while you write it: one line on your side, and its message slot. */
export function ReplyField({
  id,
  label,
  icon,
  line,
  children,
}: {
  readonly id: string;
  /** The field's name for assistive technology; on screen, Taalcut's question above it and its hint ask for it. */
  readonly label: string;
  readonly icon: LucideIcon;
  /** What the message slot holds: the field's problem, or nothing. */
  readonly line: ReactNode;
  /** The input, built by the thread (it owns the value and the refs). */
  readonly children: ReactNode;
}) {
  return (
    <div data-slot="reply" className="flex w-full max-w-[22rem] flex-col gap-1 self-end">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <FieldGlyph icon={icon} />
        {children}
      </div>
      <MessageSlot id={`${id}-line`}>{line}</MessageSlot>
    </div>
  );
}

const CHANGE =
  'inline-flex h-6 items-center gap-1 rounded-sm type-meta text-ink-2 underline decoration-rule-strong decoration-1 ' +
  'underline-offset-4 transition-colors duration-(--dur-micro) not-disabled:hover:text-ink ' +
  'not-disabled:hover:decoration-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:no-underline';

/** What you answered: your bubble, and Change under it, which opens the reply again with your words in it. */
export function Answer({
  field,
  label,
  children,
  onChange,
  disabled,
}: {
  readonly field: 'name' | 'email';
  /** The field's name ("Your name"), so Change says what it changes. */
  readonly label: string;
  readonly children: ReactNode;
  readonly onChange: () => void;
  readonly disabled: boolean;
}) {
  return (
    <div data-slot="answer" data-field={field} className="flex w-full flex-col items-end gap-1">
      <Bubble side="you" pop>
        {children}
      </Bubble>
      <button type="button" onClick={onChange} disabled={disabled} className={CHANGE}>
        <Pencil aria-hidden size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0" />
        {CONTACT_PAGE.thread.change}
        <span className="sr-only"> {label.toLowerCase()}</span>
      </button>
    </div>
  );
}

export const REPLY_CLASS = FIELD_WITH_GLYPH;
export const NAME_ICON = UserRound;
export const EMAIL_ICON = ICONS.mail;

const SEND =
  'inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-pill border border-transparent bg-inverse px-5 ' +
  'type-label font-semibold text-on-inverse select-none ' +
  'transition-[background-color,color,transform] duration-(--dur-micro) ease-(--ease-out) ' +
  'not-disabled:hover:bg-ink-2 not-disabled:active:scale-[0.98] motion-reduce:active:scale-100 aria-busy:cursor-progress ' +
  'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-control disabled:text-ink-disabled';

const COMPOSER_FIELD = cn(FACE, LOCKED, 'block min-h-[4.75rem] resize-none rounded-[1.375rem] py-3 text-base');

/** The composer: the message box and Send, then the box's message slot. */
export function Composer({
  id,
  textarea,
  value,
  onChange,
  onFocus,
  onBlur,
  onSend,
  busy,
  open,
  invalid,
  line,
}: {
  readonly id: string;
  readonly textarea: RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onSend: () => void;
  readonly busy: boolean;
  readonly open: boolean;
  readonly invalid: boolean;
  readonly line: ReactNode;
}) {
  const Spinner = FORM_ICONS.spinner;
  const count = value.length;
  const reduce = useReducedMotionPref();
  const sendRef = useRef<HTMLButtonElement>(null);
  /** Once the message has words, Send is on screen: the page scrolls the least it can to show it whole. */
  const write = (next: string) => {
    onChange(next);
    if (next.trim().length > 0)
      sendRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <div
      data-slot="composer"
      className="flex flex-col gap-1.5 rounded-b-window border-t border-rule-subtle bg-raised px-3 pt-3 sm:px-4"
    >
      {/* A chat's composer has no label over it: the label is for assistive technology, the hint shows in the box,
       * and the count appears near the limit. */}
      <label htmlFor={id} className="sr-only">
        {CONTACT_WORDS.messageLabel}
      </label>
      {count >= 1500 ? (
        <p className="m-0 self-end type-meta text-ink-2">
          {count.toLocaleString('en')} / {CONTACT_LIMITS.message.toLocaleString('en')}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          id={id}
          rows={2}
          value={value}
          required
          disabled={!open}
          readOnly={busy}
          placeholder={CONTACT_WORDS.messageHint}
          onChange={(e) => write(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-line`}
          className={COMPOSER_FIELD}
        />
        <button
          ref={sendRef}
          type="submit"
          disabled={!open}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          aria-label={busy ? CONTACT_WORDS.submitting : CONTACT_WORDS.submit}
          className={SEND}
        >
          {busy ? (
            <Spinner aria-hidden size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="animate-spin" />
          ) : (
            <Send aria-hidden size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          )}
          <span className="max-[22.5rem]:sr-only">{CONTACT_WORDS.send}</span>
        </button>
      </div>
      <MessageSlot id={`${id}-line`}>{line}</MessageSlot>
      {open ? (
        <noscript>
          <p className="m-0 pb-2 type-body text-ink-2">{CONTACT_WORDS.noScript}</p>
        </noscript>
      ) : null}
    </div>
  );
}
