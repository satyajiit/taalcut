// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit intro and outro (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * what plays before and after every video: none, a clip from the library, or a title card in the heading font on
 *   one of the kit's colours for 1 to 4 seconds
 * states: default · hover/active/focus-visible (Segmented, Select, field) · disabled (read-only) · loading (the
 *   library's clips arriving: the select is busy; saving) · error (empty card text: the reason under the field;
 *   refused: the status line) · success (Saved) · a clip not chosen yet (the select waits; nothing saved) · no
 *   clips in the library (the clip choice says so)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import { BUMPER_BACKGROUNDS, FrameRates, RationalTime, type Style } from '@taalcut/core';
import { Segmented } from '@taalcut/ui';
import { useId, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { formatClipLength } from '../shared/format';
import { Select } from '../settings/fields';
import { CommitInput } from './commit-fields';
import type { StyleEditor } from './use-style-editor';

type Bumper = NonNullable<Style['intro']>;
type Kind = 'none' | Bumper['kind'];
type Background = (typeof BUMPER_BACKGROUNDS)[number];
const LENGTHS = ['1', '2', '3', '4'] as const;
const seconds = (n: number) => RationalTime.fromSeconds(n, FrameRates.milliseconds);

/** The library's newest clips, for an intro or outro clip. */
function useClips(on: boolean) {
  const backend = useBackend();
  return useRpcQuery(
    async (signal) =>
      on
        ? (
            await backend.library.browse(
              { filters: { kinds: ['video'] }, sort: 'added', limit: 40 },
              { signal },
            )
          ).items
        : [],
    [backend, on],
  );
}

export function BumperField({
  editor,
  which,
  disabled,
}: {
  editor: StyleEditor;
  which: 'intro' | 'outro';
  disabled?: boolean;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const style = editor.style;
  const current = style?.[which] ?? null;
  // "A clip" picked but no clip chosen yet: nothing is saved until one is.
  const [choosingClip, setChoosingClip] = useState(false);
  const kind: Kind = choosingClip ? 'clip' : (current?.kind ?? 'none');
  const clips = useClips(kind === 'clip');
  if (!style) return null;
  const label = which === 'intro' ? t`Intro` : t`Outro`;
  const set = (next: Bumper | null) => editor.commit(which, () => ({ [which]: next }));
  const card = current?.kind === 'card' ? current : null;
  const colourWords: Record<Background, string> = {
    primary: t`Main colour`,
    secondary: t`Second colour`,
    background: t`Background`,
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1.5 p-0 type-label text-ink">{label}</legend>
      <Segmented<Kind>
        className="self-start"
        label={label}
        value={kind}
        disabled={disabled}
        options={[
          { value: 'none', label: t`None` },
          { value: 'clip', label: t`A clip` },
          { value: 'card', label: t`A title card` },
        ]}
        onChange={(next) => {
          setChoosingClip(next === 'clip' && current?.kind !== 'clip');
          if (next === 'none') void set(null);
          if (next === 'card')
            void set({
              kind: 'card',
              text: style.name.slice(0, 80),
              duration: seconds(2),
              background: 'primary',
            });
        }}
      />
      {kind === 'clip' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-clip`} className="type-label text-ink">
            {t`Clip`}
          </label>
          <Select
            id={`${id}-clip`}
            value={current?.kind === 'clip' ? current.assetId : ''}
            disabled={disabled || !clips.data}
            aria-busy={!clips.data || undefined}
            onChange={(event) => {
              const clip = clips.data?.find((item) => item.id === event.target.value);
              if (!clip) return;
              setChoosingClip(false);
              void set({ kind: 'clip', assetId: clip.id, range: null });
            }}
          >
            <option value="" disabled>
              {clips.data && clips.data.length === 0 ? t`No clips in your library yet` : t`Choose a clip`}
            </option>
            {current?.kind === 'clip' && !clips.data?.some((item) => item.id === current.assetId) ? (
              <option value={current.assetId}>{t`The clip chosen before`}</option>
            ) : null}
            {clips.data?.map((clip) => (
              <option key={clip.id} value={clip.id} translate="no">
                {clip.duration
                  ? `${clip.name} · ${formatClipLength(i18n, RationalTime.toSeconds(clip.duration))}`
                  : clip.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {card ? (
        <div className="flex flex-col gap-3">
          <CommitInput
            label={t`Card words`}
            value={card.text}
            maxLength={80}
            userContent
            disabled={disabled}
            validate={(text) => (text.trim() ? null : t`Write the words for the card, or choose None.`)}
            onCommit={(text) =>
              editor.commit(`${which}.text`, (now) => {
                const was = now[which];
                return was?.kind === 'card' ? { [which]: { ...was, text: text.trim() } } : {};
              })
            }
          />
          <span className="-mb-1.5 type-label text-ink">{t`Length`}</span>
          <Segmented<(typeof LENGTHS)[number]>
            className="self-start"
            label={t`Card length`}
            value={
              LENGTHS.find((n) => Number(n) === Math.round(RationalTime.toSeconds(card.duration))) ?? null
            }
            disabled={disabled}
            options={LENGTHS.map((n) => ({
              value: n,
              label: i18n.number(Number(n), { style: 'unit', unit: 'second', unitDisplay: 'narrow' }),
            }))}
            onChange={(n) => void set({ ...card, duration: seconds(Number(n)) })}
          />
          <span className="-mb-1.5 type-label text-ink">{t`Colour`}</span>
          <Segmented<Background>
            className="self-start"
            label={t`Card colour`}
            value={card.background}
            disabled={disabled}
            options={BUMPER_BACKGROUNDS.map((value) => ({ value, label: colourWords[value] }))}
            onChange={(background) => void set({ ...card, background })}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
