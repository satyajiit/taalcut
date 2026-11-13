// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: form parts (field, message slot, status line, retry button, submit button, tick) · shared by the
 *   waitlist and contact forms
 * mode: Persuade · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Inputs and choices, Buttons, Feedback, Motion › Tick)
 * states: field default (raised, rule-strong edge) · hover (edge ink-3) · focus (canvas face, edge ink-2, base ring)
 *   · disabled (sunken, ink-disabled) · read-only while sending (sunken) · error (danger-strong edge, aria-invalid)
 *   · message slot empty (one line's height, held) · filled (the status line, its Try again inline)
 *   · button default · hover · focus · active (2% give) · disabled (the closed state only) · loading (spinner, words
 *   change, aria-busy)
 * reduced motion: the tick is whole and fades in; the spinner keeps turning, slower (base.css) */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode, SVGProps } from 'react';
import { Button, type ButtonVariant } from '#components/ui/button';
import { cn } from '#lib/cn';
import { ICON_SIZE, ICON_STROKE } from '#lib/icons';
import { FORM_ICONS } from './form-icons';

export { FORM_ICONS };

/**
 * A field's face. The words are 17 px (`text-lg`, not a role) because iOS zooms the page into any field set under
 * 16 px, and /waitlist/ is the Instagram link's target on a phone.
 */
export const FACE =
  'w-full min-w-0 border border-rule-strong bg-raised px-5 text-lg text-ink shadow-xs ' +
  'transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out) ' +
  'placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas ' +
  'aria-invalid:border-danger-strong ' +
  'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled disabled:shadow-none disabled:placeholder:text-ink-disabled';

/** Locked while the form sends. Text fields only: a select always matches :read-only. */
export const LOCKED = 'read-only:bg-sunken read-only:shadow-none';

/** A one-line field: a pill, like the button beside it. */
export const FIELD = cn(FACE, LOCKED, 'h-12 rounded-pill');

/** A one-line field with its glyph inside, at the start (FieldGlyph): room for it before the words. */
export const FIELD_WITH_GLYPH = cn(FIELD, 'ps-12');

/** The glyph inside a field's start (the mail for an address, the person for a name); its wrapper is `relative`. */
export function FieldGlyph({ icon: Icon }: { readonly icon: LucideIcon }) {
  return (
    <Icon
      aria-hidden
      size={ICON_SIZE.lg}
      strokeWidth={ICON_STROKE}
      className="pointer-events-none absolute start-4.5 top-1/2 -translate-y-1/2 text-ink-3"
    />
  );
}

/** A message box: rounded, and it grows downwards. */
export const AREA = cn(FACE, LOCKED, 'min-h-36 resize-y rounded-2xl py-3');

/** A native select on the field's face, with room for its chevron (SelectChevron). */
export const SELECT = cn(FACE, 'h-12 cursor-pointer appearance-none rounded-pill pe-12');

/** The chevron a SELECT draws over its right end; the wrapper around both is `relative`. */
export function SelectChevron() {
  const Chevron = FORM_ICONS.chevron;
  return (
    <Chevron
      size={ICON_SIZE.md}
      strokeWidth={ICON_STROKE}
      aria-hidden
      className="pointer-events-none absolute end-5 top-1/2 -translate-y-1/2 text-ink-2"
    />
  );
}

export const LABEL = 'type-label text-ink';

/** A field's label row: the words, and an optional quiet note at the end ("Optional", a count). */
export function FieldLabel({
  htmlFor,
  children,
  note,
}: {
  readonly htmlFor: string;
  readonly children: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className={LABEL}>
        {children}
      </label>
      {note ? <span className="type-meta text-ink-2">{note}</span> : null}
    </div>
  );
}

/**
 * A field's message slot: always there, one line high even when empty (two under 360 px, where a message can wrap),
 * so a message that appears never moves what is under it (Hallmark gate 39). The field's `aria-describedby` names its id; it holds a StatusLine only when there
 * is a problem. Without an id it holds a line that isn't a field's (the contact form's reply line), or, empty, keeps a
 * field's rhythm beside fields that have one.
 */
export function MessageSlot({ id, children }: { readonly id?: string; readonly children?: ReactNode }) {
  return (
    <div id={id} className="min-h-[2lh] type-body min-[22.5rem]:min-h-[1lh]">
      {children}
    </div>
  );
}

/**
 * The line under a field when something went wrong: its glyph, the cause and the fix in ink, and at most one action.
 * One line, no wash, no edge (DESIGN.md › Feedback). The action (a RetryButton) ends the sentence on the text's own
 * line, so the line fits its slot: two lines at 320 px, one from 360. `alert` makes a screen reader say it at once; a
 * field's own problem doesn't need it, because focus moves to the field and the field reads its description.
 */
export function StatusLine({
  id,
  tone,
  alert = false,
  children,
  action,
}: {
  readonly id?: string;
  readonly tone: 'error' | 'offline';
  readonly alert?: boolean;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  const Icon = tone === 'error' ? FORM_ICONS.error : FORM_ICONS.offline;
  return (
    <div id={id} role={alert ? 'alert' : undefined} data-tone={tone}>
      <p className="m-0 flex min-w-0 items-start gap-2 type-body text-ink">
        <Icon
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('mt-[3px] shrink-0', tone === 'error' ? 'text-danger-strong' : 'text-ink-2')}
        />
        <span className="min-w-0">
          {children}
          {action ? <> {action}</> : null}
        </span>
      </p>
    </div>
  );
}

/* component: retry button · Try again at the end of a status line's sentence
 * mode: Persuade · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Feedback: one Try again; Icons: try again carries its glyph)
 * states: default (ink words, rule-strong underline, ink-2 glyph) · hover (underline ink) · focus (base ring)
 *   · active (words ink-2) · disabled: none (the line goes away while the form sends)
 * A real <button>, 24 px tall in a 22 px line: its 1 px overhang above and below is cancelled by its margins, so the
 * line box keeps its height. It never wraps inside itself: a narrow line moves it whole to the next line. */
export function RetryButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  const Retry = FORM_ICONS.retry;
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-px inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm align-top text-ink underline decoration-rule-strong decoration-1 underline-offset-4 transition-colors duration-(--dur-micro) hover:decoration-ink active:text-ink-2"
    >
      <Retry size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-ink-2" />
      {label}
    </button>
  );
}

/**
 * The form's send button. While sending it keeps its place and its width, puts a spinner where the words start and
 * changes the words ("Joining…"); a second press does nothing. It has one face from the server HTML on: `disabled`
 * is for the closed state alone. A send before the script runs is harmless because the forms' fields have no `name`,
 * so a native submit carries nothing.
 */
export function SubmitButton({
  variant = 'primary',
  busy,
  disabled = false,
  label,
  busyLabel,
  className,
}: {
  readonly variant?: ButtonVariant;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly busyLabel: string;
  readonly className?: string;
}) {
  const Spinner = FORM_ICONS.spinner;
  return (
    <Button
      type="submit"
      variant={variant}
      size="lg"
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={cn('min-w-44', className)}
    >
      {busy ? (
        <Spinner size={ICON_SIZE.md} strokeWidth={ICON_STROKE} aria-hidden className="animate-spin" />
      ) : null}
      {busy ? busyLabel : label}
    </Button>
  );
}

/** Lucide's check, drawn in from its short end when it appears (the app's Tick, recreated: the site imports no package). */
export function Tick({
  size = 16,
  className,
  strokeWidth = 2,
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'children'> & { readonly size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      {...props}
    >
      <path
        d="m4 12 5 5L20 6"
        pathLength={1}
        className="[stroke-dasharray:1] [stroke-dashoffset:0] transition-[stroke-dashoffset,opacity] duration-(--dur-short) ease-(--ease-out) starting:opacity-0 starting:[stroke-dashoffset:1]"
      />
    </svg>
  );
}
