// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a slot's description, read and edited in place (BRK1-REV) · system: DESIGN.md
 *   v0.7 (violet: the AI's reading; teal: yours)
 * what the shot should be, led by the AI mark when Taalcut wrote it and "You" when you did; Edit opens a field in
 *   its place: ⌘↩ or Save keeps it (template.slot.editIntent, so the intent becomes yours), Escape or Cancel leaves
 *   it as it was. Shot and energy follow as chips, and between them (FRM1-MOT) the camera's move, measured, as a
 *   small menu button to change it (camera-move.tsx)
 * states: default · editing (the field, Save and Cancel) · saving (Save spins) · error (the panel's line; the field
 *   stays open with your words) · read-only (no Edit)
 */
import { useLingui } from '@lingui/react/macro';
import type { CameraMotion, Template } from '@taalcut/core';
import { useEffect, useId, useRef, useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { UserContent } from '../cards/card-frame';
import { REVIEW_ICONS } from './review-icons';
import { CameraMove } from './camera-move';
import { energyLabel, SHOT_TYPE_LABELS } from './slot-words';

export interface DescriptionFieldProps {
  slot: Template['slots'][number];
  number: string;
  saving: boolean;
  /** Saves the words; resolves true when they were kept. Undefined: read-only. */
  onSave?: ((text: string) => Promise<boolean>) | undefined;
  /** FRM1-MOT: picks the camera's move (null: "I don't know"). Undefined: read-only. */
  onSetMotion?: ((motion: CameraMotion | null) => void) | undefined;
  /** The camera's move is being set. */
  settingMotion?: boolean;
  /** Another fix is on its way. */
  busy?: boolean;
}

export function DescriptionField({
  slot,
  number,
  saving,
  onSave,
  onSetMotion,
  settingMotion = false,
  busy = false,
}: DescriptionFieldProps) {
  const { t, i18n } = useLingui();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(slot.intent.text);

  useEffect(() => {
    setEditing(false);
    setText(slot.intent.text);
  }, [slot.id, slot.intent.text]);
  const edit = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) field.current?.select();
    // Saved or cancelled: focus goes back to Edit, not to the sheet.
    else if (wasEditing.current) requestAnimationFrame(() => edit.current?.focus({ preventScroll: true }));
    wasEditing.current = editing;
  }, [editing]);

  const save = async () => {
    const words = text.trim();
    if (!words || words === slot.intent.text) return setEditing(false);
    if (await onSave?.(words)) setEditing(false);
  };

  return (
    <div data-slot="slot-description" className="flex flex-col gap-2">
      {editing && onSave ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={id} className="type-label-sm text-ink-2">
            {t`What slot ${number} shows`}
          </label>
          <textarea
            ref={field}
            id={id}
            value={text}
            maxLength={500}
            rows={2}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setText(slot.intent.text);
                setEditing(false);
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
            className="min-h-16 w-full resize-y rounded-md border border-rule-strong bg-raised px-3 py-2 type-body text-ink shadow-xs hover:border-ink-3 focus:border-ink-2 focus:bg-canvas"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={saving} disabled={!text.trim()}>
              {t`Save`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t`Cancel`}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          {slot.intent.source === 'user' ? (
            <Chip tone="you" className="mt-0.5">
              {t`You`}
            </Chip>
          ) : (
            <AiMark className="mt-1 size-3.5 shrink-0" label={t`Taalcut’s reading`} />
          )}
          <UserContent translate="no" className="min-w-0 flex-1 type-prose text-ink">
            {slot.intent.text || t`Not read yet`}
          </UserContent>
          {onSave ? (
            <Button
              ref={edit}
              size="sm"
              variant="ghost"
              icon={REVIEW_ICONS.describe}
              onClick={() => setEditing(true)}
              aria-label={t`Edit what slot ${number} shows`}
            >
              {t`Edit`}
            </Button>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {slot.intent.shotType ? <Chip>{i18n._(SHOT_TYPE_LABELS[slot.intent.shotType])}</Chip> : null}
        <CameraMove slot={slot} number={number} busy={settingMotion} disabled={busy} onPick={onSetMotion} />
        <Chip>{energyLabel(i18n, slot.intent.energy)}</Chip>
      </div>
    </div>
  );
}
