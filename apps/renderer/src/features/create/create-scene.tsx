// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · mode: Operate · system: DESIGN.md · focused scene fields; editable, pending and locked; source content remains user content. */

import { useLingui } from '@lingui/react/macro';
import { FrameRates, RationalTime, type CreationDraft } from '@taalcut/core';
import { Input, UserContent } from '@taalcut/ui';
import { Field } from '../settings/fields';
import { CreationText } from './create-fields';

type Beat = CreationDraft['beats'][number];

export function CreationScene({
  entry,
  index,
  design,
  disabled,
  onChange,
}: {
  entry: Beat;
  index: number;
  design: boolean;
  disabled: boolean;
  onChange: (change: Partial<Beat>) => void;
}) {
  const { t, i18n } = useLingui();
  const sceneNumber = i18n.number(index + 1);
  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
      <legend className="mb-3 type-card-title text-ink">
        {t`Scene ${sceneNumber}`}
        {entry.screenText ? (
          <UserContent className="ms-3 inline break-words type-body text-ink-2">
            {entry.screenText}
          </UserContent>
        ) : null}
      </legend>
      {design ? (
        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <Field htmlFor={`visual-${entry.id}`} label={t`Picture & interaction`}>
            <CreationText
              id={`visual-${entry.id}`}
              value={entry.visual}
              onChange={(event) => onChange({ visual: event.target.value })}
            />
          </Field>
          <Field htmlFor={`transition-${entry.id}`} label={t`Connection to the next scene`}>
            <CreationText
              id={`transition-${entry.id}`}
              value={entry.transition}
              onChange={(event) => onChange({ transition: event.target.value })}
            />
          </Field>
        </div>
      ) : (
        <>
          <Field htmlFor={`narration-${entry.id}`} label={t`Narration`}>
            <CreationText
              id={`narration-${entry.id}`}
              value={entry.narration}
              onChange={(event) => onChange({ narration: event.target.value })}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field htmlFor={`screen-${entry.id}`} label={t`On-screen words`}>
              <Input
                id={`screen-${entry.id}`}
                value={entry.screenText}
                onChange={(event) => onChange({ screenText: event.target.value })}
              />
            </Field>
            <Field htmlFor={`duration-${entry.id}`} label={t`Length in seconds`}>
              <Input
                id={`duration-${entry.id}`}
                type="number"
                min={0.1}
                step={0.1}
                value={RationalTime.toSeconds(entry.duration)}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value) && value > 0)
                    onChange({ duration: { value: Math.round(value * 60), rate: FrameRates.fps60 } });
                }}
              />
            </Field>
          </div>
        </>
      )}
    </fieldset>
  );
}
