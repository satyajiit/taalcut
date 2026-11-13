// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit colours (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * five colours, each a swatch that opens the Mac's colour picker and a hex field beside it; under them, how the
 *   kit's text reads on its background, with a warning line below 4.5:1
 * states: default · hover (swatch edge ink-3) · focus-visible (base ring on swatch and field) · active (picker
 *   open) · disabled (read-only) · loading (saving: the field is busy) · error (not a colour: the reason under the
 *   field, Escape restores) · success (Saved, in the editor's status line) · low contrast (the warning line)
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { StyleSummary } from '@taalcut/core';
import { useEffect, useRef } from 'react';
import { Notice } from '../settings/fields';
import { CommitInput } from './commit-fields';
import { contrastRatio, normaliseHex, TEXT_CONTRAST } from './contrast';
import type { StyleEditor } from './use-style-editor';

type Colours = StyleSummary['colours'];
type ColourKey = keyof Colours;

const COLOURS: readonly { key: ColourKey; label: MessageDescriptor }[] = [
  { key: 'primary', label: msg`Main colour` },
  { key: 'secondary', label: msg`Second colour` },
  { key: 'accent', label: msg`Accent` },
  { key: 'text', label: msg`Text` },
  { key: 'background', label: msg`Background` },
];

export interface ColourRowProps {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (hex: string) => Promise<boolean> | void;
  readonly disabled?: boolean;
}

/** A swatch for the system colour picker (saved when the picker closes) and the same colour as hex. */
export function ColourRow({ label, value, onCommit, disabled }: ColourRowProps) {
  const { t } = useLingui();
  const picker = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const changed = () => {
      if (input.value !== value) void commitRef.current(input.value.toLowerCase());
    };
    input.addEventListener('change', changed);
    return () => input.removeEventListener('change', changed);
  }, [value]);
  return (
    <div className="flex min-w-0 items-end gap-2">
      <input
        ref={picker}
        type="color"
        defaultValue={value}
        key={value}
        disabled={disabled}
        aria-label={t`Pick ${label}`}
        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-rule-strong bg-raised p-1 transition-[border-color] duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 disabled:cursor-not-allowed"
      />
      <CommitInput
        label={label}
        value={value}
        disabled={disabled}
        maxLength={7}
        className="flex-1"
        validate={(typed) => (normaliseHex(typed) ? null : t`Use a colour like #c2410c.`)}
        onCommit={(typed) => {
          const hex = normaliseHex(typed);
          return hex && hex !== value ? onCommit(hex) : undefined;
        }}
      />
    </div>
  );
}

export function ColourFields({ editor, disabled }: { editor: StyleEditor; disabled?: boolean }) {
  const { t, i18n } = useLingui();
  const style = editor.style;
  if (!style) return null;
  const ratio = contrastRatio(style.colours.text, style.colours.background);
  const shown = i18n.number(Math.floor(ratio * 10) / 10, { maximumFractionDigits: 1 });
  const needed = i18n.number(TEXT_CONTRAST, { maximumFractionDigits: 1 });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {COLOURS.map(({ key, label }) => (
          <ColourRow
            key={key}
            label={i18n._(label)}
            value={style.colours[key]}
            disabled={disabled}
            onCommit={(hex) =>
              editor.commit(`colours.${key}`, (now) => ({ colours: { ...now.colours, [key]: hex } }))
            }
          />
        ))}
      </div>
      {ratio < TEXT_CONTRAST ? (
        <Notice tone="warning" role="status">
          {t`Text on the background is ${shown}:1, under ${needed}:1: captions and title cards will be hard to read. Pick a darker text or a lighter background, or the other way round.`}
        </Notice>
      ) : (
        <p className="m-0 type-body text-ink-2">{t`Text on the background is ${shown}:1, easy to read.`}</p>
      )}
    </div>
  );
}
