// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit watermark (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * none, the logo, or a line of text, faint in a corner of every frame: its kind, words, corner and opacity
 * states: default · hover/active/focus-visible (Segmented, field, slider) · disabled (read-only; "The logo" while
 *   the kit has none, with the reason under it) · loading (saving) · error (empty or too long text: the reason
 *   under the field; refused: the status line) · success (Saved)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { Style } from '@taalcut/core';
import { Segmented } from '@taalcut/ui';
import { CommitInput, CommitRange } from './commit-fields';
import { CornerPicker } from './logo-field';
import type { StyleEditor } from './use-style-editor';

type Watermark = NonNullable<Style['watermark']>;
type Kind = 'none' | Watermark['kind'];

export function WatermarkField({ editor, disabled }: { editor: StyleEditor; disabled?: boolean }) {
  const { t, i18n } = useLingui();
  const style = editor.style;
  if (!style) return null;
  const mark = style.watermark;
  const set = (next: Watermark | null) => void editor.commit('watermark', () => ({ watermark: next }));
  const change = (part: Partial<Pick<Watermark, 'placement' | 'opacity'>>) =>
    void editor.commit('watermark', (now) =>
      now.watermark ? { watermark: { ...now.watermark, ...part } } : {},
    );
  const choose = (kind: Kind) => {
    const placement = mark?.placement ?? 'bottomRight';
    const opacity = mark?.opacity ?? 0.3;
    if (kind === 'none') set(null);
    else if (kind === 'logo') set({ kind: 'logo', placement, opacity });
    else set({ kind: 'text', text: style.name.slice(0, 40), placement, opacity });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Segmented<Kind>
          className="self-start"
          label={t`Watermark`}
          value={mark?.kind ?? 'none'}
          disabled={disabled}
          options={[
            { value: 'none', label: t`None` },
            { value: 'logo', label: t`The logo`, disabled: style.logo === null },
            { value: 'text', label: t`Text` },
          ]}
          onChange={choose}
        />
        {style.logo === null ? (
          <p className="m-0 type-meta text-ink-2">{t`Add a logo above to use it as the watermark.`}</p>
        ) : null}
      </div>
      {mark?.kind === 'text' ? (
        <CommitInput
          label={t`Watermark text`}
          value={mark.text}
          maxLength={40}
          userContent
          disabled={disabled}
          validate={(text) => (text.trim() ? null : t`Write the words to show, or choose None.`)}
          onCommit={(text) =>
            editor.commit('watermark.text', (now) =>
              now.watermark?.kind === 'text' ? { watermark: { ...now.watermark, text: text.trim() } } : {},
            )
          }
        />
      ) : null}
      {mark ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="type-label text-ink">{t`Corner`}</span>
            <CornerPicker
              label={t`Watermark corner`}
              value={mark.placement}
              disabled={disabled}
              onChange={(placement) => change({ placement })}
            />
          </div>
          <CommitRange
            label={t`Opacity`}
            value={Math.round(mark.opacity * 100)}
            min={10}
            max={60}
            step={5}
            disabled={disabled}
            words={(value) => i18n.number(value / 100, { style: 'percent' })}
            onCommit={(value) => change({ opacity: value / 100 })}
          />
        </div>
      ) : null}
    </div>
  );
}
