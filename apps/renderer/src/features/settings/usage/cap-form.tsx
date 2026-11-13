// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: a budget's amount form · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4
 * the kit's MoneyInput with its label above and Save after it (then the caller's own buttons: No budget, Cancel);
 *   a wrong amount says what to type, under the field. When the saved amount changes elsewhere (⌘Z, the budget
 *   card) the field follows it, unless you are typing.
 * states: default · hover/focus/active (the field, Save) · disabled (another save running; Save while nothing
 *   changed) · loading (Save spins) · error (the amount line, role alert) · success (Save draws its tick and turns
 *   success for SUCCESS_HOLD_MS when the save lands, the motion grammar's Done) */
import { Trans, useLingui } from '@lingui/react/macro';
import type { Money } from '@taalcut/core';
import { Button, MoneyInput, moneyFieldText, parseMoneyText } from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

export const USD_2: Money = { currency: 'USD', micros: 2_000_000 };

/** An amount field with Save: what a cap is set with, for new projects and on a project's row. */
export function CapForm({
  initial,
  label,
  busy,
  disabled,
  saved = false,
  onSave,
  fresh = false,
  focusOnOpen = false,
  children,
}: {
  initial: Money;
  label: string;
  busy: boolean;
  disabled: boolean;
  /** The last save landed: Save shows its tick for a moment. */
  saved?: boolean;
  onSave: (cap: Money) => void;
  /** Nothing is set yet: the suggested amount can be saved as it is. */
  fresh?: boolean;
  /** Opened by a button that goes away (a row's Change): the amount takes the focus, so it isn't lost. */
  focusOnOpen?: boolean;
  children?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const field = useId();
  const help = useId();
  const initialText = moneyFieldText(initial, i18n.locale);
  const [text, setText] = useState(initialText);
  const [base, setBase] = useState(initialText);
  // The saved amount changed underneath (a save, ⌘Z): show it, as the field had before it was edited.
  if (base !== initialText) {
    setBase(initialText);
    setText(initialText);
  }
  const [wrong, setWrong] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);
  // A project without a budget may take the suggested amount as it is.
  const unchanged = !fresh && parseMoneyText(text, i18n.locale, initial.currency) === initial.micros;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    const micros = parseMoneyText(text, i18n.locale, initial.currency);
    if (micros === null || micros <= 0) {
      const example = moneyFieldText(USD_2, i18n.locale);
      return setWrong(t`Enter an amount, like ${example}.`);
    }
    setWrong(null);
    onSave({ currency: initial.currency, micros });
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor={field} className="type-label text-ink">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <MoneyInput
          ref={input}
          id={field}
          currency={initial.currency}
          value={text}
          invalid={wrong !== null}
          aria-describedby={wrong ? help : undefined}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            if (wrong) setWrong(null);
          }}
          className="w-32"
        />
        <Button
          type="submit"
          size="sm"
          loading={busy}
          {...(saved ? { status: 'success' as const } : {})}
          // While its tick shows, Save stays as it was pressed: the success is the answer, not a disabled button.
          disabled={!saved && (disabled || unchanged)}
        >
          <Trans>Save</Trans>
        </Button>
        {children}
      </div>
      {wrong ? (
        <p id={help} role="alert" className="m-0 type-body text-danger-strong">
          {wrong}
        </p>
      ) : null}
    </form>
  );
}
