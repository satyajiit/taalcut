// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: switch row (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * a setting that applies the moment you flip it: the kit's Switch with its words, so the whole row is the hit area
 *   (clicking the name or its line flips it, as on macOS); the switch at the row's end. In a SettingRows frame
 *   (`as="li"`) it is one of its rows; alone it sits in a frame of its own. Anything under it (a code field, a budget
 *   form) sits below a hairline, outside the hit area.
 * states: default · hover (the row washes and the track steps up, the words included) · focus (the switch's base
 *   ring) · active (the knob presses wider) · disabled (ink-disabled, the reason in the line) · loading (the write on
 *   its way: a spinner in the knob, clicks held) · error (the switch back where it was, the cause under the row) ·
 *   success (the new position, its tick drawn in, is the answer) */

import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { HOVER_EASE, Switch, cn } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { Notice } from './fields';
import { describeError } from './model-messages';

export interface SwitchRowProps {
  label: ReactNode;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy?: boolean;
  disabled?: boolean;
  /** The last write failed: shown under the row, the switch back where it was. */
  error?: TaalcutError | null | undefined;
  /** Under the description, e.g. the alpha code field or budget cap form. */
  children?: ReactNode;
  className?: string;
  /** `li`: a row of the SettingRows around it. Default: a row in its own frame. */
  as?: 'div' | 'li';
  'data-setting'?: string;
}

/** The frame a lone switch row sits in: the same hairline box as a SettingRows list of one. */
const OWN_FRAME = 'overflow-hidden rounded-lg border border-rule-subtle bg-raised';
/** A row of a SettingRows list: a hairline above every row but the first. */
const IN_LIST = 'border-t border-rule-subtle first:border-t-0';

/** A setting that applies the moment you flip it, as one row: its words are part of the switch. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  busy = false,
  disabled = false,
  error,
  children,
  className,
  as: Element = 'div',
  ...data
}: SwitchRowProps) {
  const { i18n } = useLingui();
  return (
    <Element
      data-slot="switch-row"
      {...data}
      className={cn('flex flex-col', Element === 'li' ? IN_LIST : OWN_FRAME, className)}
    >
      <Switch
        label={label}
        description={description}
        checked={checked}
        onCheckedChange={onChange}
        loading={busy}
        disabled={disabled}
        invalid={Boolean(error)}
        className={cn(
          'min-h-12 px-3 py-2.5',
          HOVER_EASE,
          !disabled && 'hover:bg-hover active:bg-pressed',
        )}
      />
      {children ? <div className="mx-3 border-t border-rule-subtle pt-3 pb-3">{children}</div> : null}
      {error ? (
        <Notice tone="danger" role="alert" className="px-3 pb-3">
          {describeError(i18n, error)}
        </Notice>
      ) : null}
    </Element>
  );
}
