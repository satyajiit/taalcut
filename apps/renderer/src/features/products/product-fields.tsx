// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: context and sources first, generation preferences in one disclosure.
 * States: editing, disabled, preferences open/closed; native controls and reduced-motion disclosure feedback. */

import { useLingui } from '@lingui/react/macro';
import { FrameRates, RationalTime, type ProductInput } from '@taalcut/core';
import { CONCEPT_ICONS, Input, Select } from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { CreationText } from '../create/create-fields';
import { Field } from '../settings/fields';
import { VideoFormatPicker } from '../shared/video-format-picker';

export function ProductFields({
  value,
  onChange,
  disabled,
  children,
}: {
  value: ProductInput;
  onChange: (value: ProductInput) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const Preferences = CONCEPT_ICONS.general;
  const set = (change: Partial<ProductInput>) => onChange({ ...value, ...change });
  const preferences = (change: Partial<ProductInput['preferences']>) =>
    set({ preferences: { ...value.preferences, ...change } });
  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-7 border-0 p-0">
      <Field htmlFor="product-name" label={t`Product name`}>
        <Input
          id="product-name"
          autoComplete="off"
          required
          maxLength={200}
          value={value.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field
        htmlFor="product-description"
        label={t`What should Taalcut know?`}
        hint={t`Describe your product, the features to highlight and the kinds of videos you want.`}
      >
        <CreationText
          id="product-description"
          maxLength={12000}
          value={value.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>
      {children}
      <details className="group rounded-xl border border-rule bg-raised open:pb-6">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
          <Preferences aria-hidden className="size-5 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1">
            <span className="block type-label text-ink">{t`Video preferences`}</span>
            <span className="mt-1 block type-meta text-ink-2">{t`Audience, style, formats, voice and generation limits`}</span>
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-ink-2 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="flex min-w-0 flex-col gap-6 px-5 pt-2">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field htmlFor="product-audience" label={t`Audience`}>
              <Input
                id="product-audience"
                maxLength={1000}
                value={value.preferences.audience}
                onChange={(event) => preferences({ audience: event.target.value })}
              />
            </Field>
            <Field htmlFor="product-tone" label={t`Voice and visual direction`}>
              <Input
                id="product-tone"
                maxLength={1000}
                value={value.preferences.tone}
                onChange={(event) => preferences({ tone: event.target.value })}
              />
            </Field>
            <Field htmlFor="product-cta" label={t`Call to action`}>
              <Input
                id="product-cta"
                maxLength={1000}
                value={value.preferences.callToAction}
                onChange={(event) => preferences({ callToAction: event.target.value })}
              />
            </Field>
            <Field htmlFor="product-language" label={t`Video language`}>
              <Input
                id="product-language"
                minLength={2}
                maxLength={35}
                value={value.preferences.language}
                onChange={(event) => preferences({ language: event.target.value })}
              />
            </Field>
          </div>
          <fieldset className="m-0 flex flex-wrap gap-x-6 gap-y-3 border-0 p-0">
            <legend className="mb-3 type-label text-ink">{t`Video formats`}</legend>
            <VideoFormatPicker
              values={value.preferences.formats}
              onChange={(formats) => preferences({ formats })}
              disabled={disabled}
              portraitFirst
            />
          </fieldset>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              htmlFor="product-duration"
              label={t`Length in seconds`}
              hint={t`Masters prefer 4K at 60 frames per second.`}
            >
              <Input
                id="product-duration"
                type="number"
                required
                min={5}
                max={179}
                step={1}
                value={RationalTime.toSeconds(value.preferences.duration)}
                onChange={(event) => {
                  const seconds = event.target.valueAsNumber;
                  if (Number.isFinite(seconds) && seconds > 0)
                    preferences({ duration: { value: Math.round(seconds * 60), rate: FrameRates.fps60 } });
                }}
              />
            </Field>
            <Field htmlFor="product-novelty" label={t`Days before revisiting a topic`}>
              <Input
                id="product-novelty"
                type="number"
                required
                min={1}
                max={365}
                step={1}
                value={value.preferences.noveltyDays}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber))
                    preferences({ noveltyDays: event.target.valueAsNumber });
                }}
              />
            </Field>
          </div>
          <Field
            htmlFor="product-policy"
            label={t`After researching ideas`}
            hint={t`Publishing always waits for your approval of the video, copy, accounts and time.`}
          >
            <Select
              id="product-policy"
              value={value.preferences.ideaPolicy}
              onChange={(event) =>
                preferences({ ideaPolicy: event.target.value as 'approval' | 'auto-draft' })
              }
            >
              <option value="approval">{t`Let me choose an idea first`}</option>
              <option value="auto-draft">{t`Prepare the strongest idea as a draft`}</option>
            </Select>
          </Field>
          <Field
            htmlFor="product-instructions"
            label={t`Content preferences`}
            hint={t`Suggest recurring themes, things to avoid, or examples of the videos you want.`}
          >
            <CreationText
              id="product-instructions"
              maxLength={12000}
              value={value.preferences.instructions}
              onChange={(event) => preferences({ instructions: event.target.value })}
            />
          </Field>
          <Field
            htmlFor="product-budget"
            label={t`Generation budget per video (USD)`}
            hint={t`Leave empty to use your default project limit. This includes paid generation, not publishing.`}
          >
            <Input
              id="product-budget"
              type="number"
              min={0}
              step={0.01}
              value={
                value.preferences.budgetCapMicros === null
                  ? ''
                  : value.preferences.budgetCapMicros / 1_000_000
              }
              onChange={(event) => {
                const amount = event.target.valueAsNumber;
                preferences({
                  budgetCapMicros:
                    Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 1_000_000) : null,
                });
              }}
            />
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field htmlFor="product-voice-mode" label={t`Voiceover`}>
              <Select
                id="product-voice-mode"
                value={value.preferences.voice.mode}
                onChange={(event) =>
                  preferences({
                    voice: {
                      ...value.preferences.voice,
                      mode: event.target.value as 'none' | 'connected',
                      language: value.preferences.language,
                    },
                  })
                }
              >
                <option value="none">{t`No voiceover`}</option>
                <option value="connected">{t`Generate a voiceover`}</option>
              </Select>
            </Field>
            {value.preferences.voice.mode === 'connected' ? (
              <Field htmlFor="product-voice-id" label={t`Connected voice ID`}>
                <Input
                  id="product-voice-id"
                  value={value.preferences.voice.voiceId ?? ''}
                  onChange={(event) =>
                    preferences({
                      voice: { ...value.preferences.voice, voiceId: event.target.value || null },
                    })
                  }
                />
              </Field>
            ) : null}
            <Field htmlFor="product-drafts" label={t`Maximum drafts per day`}>
              <Input
                id="product-drafts"
                type="number"
                min={1}
                max={100}
                required
                value={value.preferences.maxDraftsPerDay}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber))
                    preferences({ maxDraftsPerDay: event.target.valueAsNumber });
                }}
              />
            </Field>
          </div>
        </div>
      </details>
    </fieldset>
  );
}
