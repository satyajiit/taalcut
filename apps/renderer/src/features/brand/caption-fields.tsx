// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit caption look (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the look captions take from the kit: none (videos keep theirs), one of render's presets to start from, then its
 *   font, size and two colours; for a measured look, the matched font in words and a button to draw captions in
 *   the caption font the match chose (never the match's own family when render can't draw it, §11)
 * states: default · hover/active/focus-visible (Select, slider, Button) · disabled (read-only) · loading (saving)
 *   · error (refused: the status line) · success (Saved) · no captions (one select, nothing else) · font matched
 *   (the line, and the button while captions use another face)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import {
  CAPTION_FONTS,
  CAPTION_PRESET_IDS,
  CAPTION_PRESETS,
  type CaptionStyle,
  type Style,
} from '@taalcut/core';
import { Button, CAPTION_PRESET_LABELS, FONT_NAMES } from '@taalcut/ui';
import { Type } from 'lucide-react';
import { useId } from 'react';
import { Select } from '../settings/fields';
import { sameLook } from './caption-look';
import { ColourRow } from './colour-fields';
import { CommitRange } from './commit-fields';
import type { StyleEditor } from './use-style-editor';

const NONE = 'none';
const OWN = 'own';

function FontMatchLine({ style, onUse }: { style: Style; onUse: (captions: CaptionStyle) => void }) {
  const { t } = useLingui();
  const match = style.fontMatch;
  if (!match) return null;
  const family = FONT_NAMES[match.family];
  const captionFont = FONT_NAMES[match.captionFont];
  const drawn = match.family === match.captionFont;
  const next = style.captions
    ? { ...style.captions, font: match.captionFont }
    : { ...CAPTION_PRESETS.classic, font: match.captionFont };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 type-body text-ink-2">
      <Type aria-hidden className="size-4 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1" translate="no">
        {drawn
          ? t`The reference’s text is closest to ${family}.`
          : t`The reference’s text is closest to ${family}. Captions can’t use it, so they use ${captionFont}.`}
      </span>
      {style.captions?.font === match.captionFont ? null : (
        <Button size="sm" onClick={() => onUse(next)}>
          {t`Use ${captionFont} for captions`}
        </Button>
      )}
    </div>
  );
}

export function CaptionFields({ editor, disabled }: { editor: StyleEditor; disabled?: boolean }) {
  const { t, i18n } = useLingui();
  const id = useId();
  const style = editor.style;
  if (!style) return null;
  const captions = style.captions;
  const preset = captions
    ? (CAPTION_PRESET_IDS.find((key) => sameLook(CAPTION_PRESETS[key], captions)) ?? OWN)
    : NONE;
  const set = (next: CaptionStyle | null) => editor.commit('captions', () => ({ captions: next }));
  const change = (part: Partial<CaptionStyle>) =>
    editor.commit('captions', (now) => (now.captions ? { captions: { ...now.captions, ...part } } : {}));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-look`} className="type-label text-ink">
          {t`Caption look`}
        </label>
        <Select
          id={`${id}-look`}
          value={preset}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            const picked = CAPTION_PRESET_IDS.find((key) => key === value);
            if (value === NONE) void set(null);
            else if (picked) void set(CAPTION_PRESETS[picked]);
          }}
        >
          <option value={NONE}>{t`None: videos keep their own caption look`}</option>
          {CAPTION_PRESET_IDS.map((key) => (
            <option key={key} value={key}>
              {i18n._(CAPTION_PRESET_LABELS[key])}
            </option>
          ))}
          {preset === OWN ? <option value={OWN}>{t`Your own look`}</option> : null}
        </Select>
      </div>
      {captions ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-font`} className="type-label text-ink">
              {t`Caption font`}
            </label>
            <Select
              id={`${id}-font`}
              value={captions.font}
              disabled={disabled}
              onChange={(event) => {
                const font = CAPTION_FONTS.find((name) => name === event.target.value);
                if (font) void change({ font });
              }}
            >
              {CAPTION_FONTS.map((font) => (
                <option key={font} value={font} translate="no">
                  {FONT_NAMES[font]}
                </option>
              ))}
            </Select>
          </div>
          <CommitRange
            label={t`Caption size`}
            value={captions.sizePx}
            min={44}
            max={160}
            step={4}
            disabled={disabled}
            words={(px) => {
              const size = i18n.number(px);
              return t`${size} px on a 1080-wide frame`;
            }}
            onCommit={(sizePx) => void change({ sizePx })}
          />
          <ColourRow
            label={t`Caption colour`}
            value={captions.textColor}
            disabled={disabled}
            onCommit={(textColor) => change({ textColor })}
          />
          <ColourRow
            label={t`Highlighted word`}
            value={captions.highlightColor}
            disabled={disabled}
            onCommit={(highlightColor) => change({ highlightColor })}
          />
        </div>
      ) : null}
      <FontMatchLine style={style} onUse={(next) => void set(next)} />
    </div>
  );
}
