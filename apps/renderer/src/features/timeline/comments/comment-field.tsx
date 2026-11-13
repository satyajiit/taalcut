// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comment field · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the words of a comment, in the composer and when you edit one in the dock: a plain field with its label, up to
 *   1000 characters (the count shows near the end, else the caller's hint); ⌘↩ saves, Escape is the dialog's or the row's
 * states: default · hover · focus (ink border, canvas fill) · disabled (saving) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { COMMENT_BODY_MAX } from '@taalcut/core';
import { useId, type KeyboardEvent } from 'react';

/** The count shows once this close to the limit. */
const NEAR_LIMIT = 100;

export function CommentField({
  label,
  value,
  onChange,
  onSubmit,
  disabled,
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** A line under the field (why its button waits); the count takes its place near the limit. */
  hint?: string | undefined;
}) {
  const { t } = useLingui();
  const id = useId();
  const left = COMMENT_BODY_MAX - value.length;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        data-slot="comment-field"
        value={value}
        maxLength={COMMENT_BODY_MAX}
        rows={3}
        disabled={disabled}
        // A field the person opened on purpose (Comment…, Edit) takes the keys at once.
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-md border border-rule-strong bg-raised px-3 py-2 text-base text-ink shadow-xs hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas disabled:bg-sunken disabled:text-ink-disabled"
      />
      {left <= NEAR_LIMIT ? (
        <span className="min-h-4 text-xs text-ink-3 tabular-nums" aria-live="polite">
          {t`${left} characters left`}
        </span>
      ) : hint !== undefined ? (
        <span className="min-h-4 text-xs text-ink-3">{hint}</span>
      ) : null}
    </div>
  );
}
