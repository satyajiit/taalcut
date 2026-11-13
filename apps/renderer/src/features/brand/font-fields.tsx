// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit fonts (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the heading and body fonts from the curated list (the faces render can draw), each with its weight and a sample
 *   in Latin and in Devanagari, so the person sees both scripts before choosing
 * states: default · hover/active (Select's own) · focus-visible (base ring) · disabled (read-only) · loading
 *   (saving: the select is busy) · error (refused: the editor's status line says why) · success (Saved)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import { CAPTION_FONTS, type Style } from '@taalcut/core';
import { FONT_NAMES, fontStack } from '@taalcut/ui';
import { useId } from 'react';
import { Select } from '../settings/fields';
import type { StyleEditor } from './use-style-editor';

type Font = Style['fonts']['heading'];
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;

// Script samples, each shown in its own script in every language (translate="no").
const LATIN = 'Golden hour at the market';
const DEVANAGARI = 'बाज़ार में सुनहरी शाम';

/** The face in both scripts it may meet: what the person reads before choosing. */
export function FontSample({ font, size = 'md' }: { font: Font; size?: 'md' | 'lg' }) {
  const css = { fontFamily: fontStack(font.family), fontWeight: font.weight };
  const text = size === 'lg' ? 'text-xl' : 'text-md';
  return (
    <div translate="no" className="flex flex-col gap-0.5 rounded-md bg-panel px-3 py-2 text-ink">
      <span lang="en" className={text} style={css}>
        {LATIN}
      </span>
      <span lang="hi" className={text} style={css}>
        {DEVANAGARI}
      </span>
    </div>
  );
}

function FontRow({
  label,
  font,
  disabled,
  onCommit,
}: {
  label: string;
  font: Font;
  disabled?: boolean;
  onCommit: (font: Font) => void;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 type-label text-ink">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
        <Select
          id={`${id}-family`}
          aria-label={t`${label}: font`}
          value={font.family}
          disabled={disabled}
          onChange={(event) => {
            const family = CAPTION_FONTS.find((name) => name === event.target.value);
            if (family) onCommit({ ...font, family });
          }}
        >
          {CAPTION_FONTS.map((family) => (
            <option key={family} value={family} translate="no">
              {FONT_NAMES[family]}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t`${label}: weight`}
          value={String(font.weight)}
          disabled={disabled}
          onChange={(event) => onCommit({ ...font, weight: Number(event.target.value) })}
        >
          {WEIGHTS.map((weight) => (
            <option key={weight} value={weight}>
              {i18n.number(weight)}
            </option>
          ))}
        </Select>
      </div>
      <FontSample font={font} />
    </fieldset>
  );
}

export function FontFields({ editor, disabled }: { editor: StyleEditor; disabled?: boolean }) {
  const { t } = useLingui();
  const style = editor.style;
  if (!style) return null;
  // Side by side only where each row has room for a readable font name beside its weight: a container query,
  // because the preview beside the editor takes more or less of the width with the language.
  return (
    <div className="@container">
      <div className="grid gap-6 @2xl:grid-cols-2">
        <FontRow
          label={t`Headings`}
          font={style.fonts.heading}
          disabled={disabled}
          onCommit={(heading) =>
            void editor.commit('fonts.heading', (now) => ({ fonts: { ...now.fonts, heading } }))
          }
        />
        <FontRow
          label={t`Body text`}
          font={style.fonts.body}
          disabled={disabled}
          onCommit={(body) => void editor.commit('fonts.body', (now) => ({ fonts: { ...now.fonts, body } }))}
        />
      </div>
    </div>
  );
}
