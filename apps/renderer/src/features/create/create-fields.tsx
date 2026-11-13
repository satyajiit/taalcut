// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { FrameRates, RationalTime } from '@taalcut/core';
import type { CreationBrief } from '@taalcut/core';
import { CONCEPT_ICONS, Input, PageSection, Select, cn } from '@taalcut/ui';
import type { ComponentProps } from 'react';
import { Field } from '../settings/fields';
import { VideoFormatPicker } from '../shared/video-format-picker';

export function CreationText({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={cn(
        'min-h-28 w-full resize-y rounded-md border border-rule-strong bg-raised px-3 py-2 type-body text-ink shadow-xs placeholder:text-ink-3 focus-visible:border-ink-2 disabled:bg-sunken disabled:text-ink-disabled',
        className,
      )}
    />
  );
}

export function BriefFields({
  value,
  onChange,
  disabled,
}: {
  value: CreationBrief;
  onChange: (brief: CreationBrief) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const set = (change: Partial<CreationBrief>) => onChange({ ...value, ...change });
  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      <Field
        htmlFor="create-prompt"
        label={t`What should the video say?`}
        hint={t`Describe the idea, the product and the feeling. Add links and project folders after saving your brief.`}
      >
        <CreationText
          id="create-prompt"
          className="min-h-36 p-4 type-prose"
          value={value.prompt}
          maxLength={12000}
          required
          onChange={(event) => set({ prompt: event.target.value })}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field htmlFor="create-title" label={t`Video name`}>
          <Input
            id="create-title"
            value={value.title}
            maxLength={200}
            required
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field htmlFor="create-category" label={t`Category`}>
          <Select
            id="create-category"
            value={value.category}
            onChange={(event) => set({ category: event.target.value as CreationBrief['category'] })}
          >
            <option value="product-launch">{t`Product launch`}</option>
            <option value="custom">{t`Write your own`}</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field htmlFor="create-audience" label={t`Who is it for?`}>
          <Input
            id="create-audience"
            value={value.audience}
            maxLength={1000}
            onChange={(event) => set({ audience: event.target.value })}
          />
        </Field>
        <Field htmlFor="create-cta" label={t`What should viewers do next?`}>
          <Input
            id="create-cta"
            value={value.callToAction}
            maxLength={1000}
            onChange={(event) => set({ callToAction: event.target.value })}
          />
        </Field>
      </div>
      <PageSection
        title={t`Video details`}
        icon={CONCEPT_ICONS.format}
        level={3}
        className="border-t border-rule-subtle pt-6"
      >
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 type-label text-ink">{t`Output formats`}</legend>
          <VideoFormatPicker
            values={value.formats}
            onChange={(formats) => set({ formats })}
            disabled={disabled}
          />
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field htmlFor="create-duration" label={t`Target length in seconds`}>
            <Input
              id="create-duration"
              type="number"
              min={5}
              max={600}
              step={1}
              required
              value={RationalTime.toSeconds(value.duration)}
              onChange={(event) => {
                const seconds = event.target.valueAsNumber;
                if (Number.isFinite(seconds) && seconds > 0)
                  set({ duration: { value: Math.round(seconds * 60), rate: FrameRates.fps60 } });
              }}
            />
          </Field>
          <Field htmlFor="create-voice" label={t`Voiceover`}>
            <Select
              id="create-voice"
              value={value.voice.mode}
              onChange={(event) =>
                set({ voice: { ...value.voice, mode: event.target.value as CreationBrief['voice']['mode'] } })
              }
            >
              <option value="none">{t`No voiceover`}</option>
              <option value="connected">{t`Generate a voiceover`}</option>
              <option value="upload">{t`Use a recording`}</option>
            </Select>
          </Field>
        </div>
        {value.voice.mode === 'connected' ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              htmlFor="create-voice-id"
              label={t`Voice`}
              hint={t`Use a voice from your connected speech provider.`}
            >
              <Input
                id="create-voice-id"
                value={value.voice.voiceId ?? ''}
                onChange={(event) => set({ voice: { ...value.voice, voiceId: event.target.value || null } })}
              />
            </Field>
            <Field htmlFor="create-language" label={t`Spoken language`}>
              <Input
                id="create-language"
                value={value.voice.language}
                minLength={2}
                maxLength={35}
                onChange={(event) => set({ voice: { ...value.voice, language: event.target.value } })}
              />
            </Field>
          </div>
        ) : null}
        {value.voice.mode === 'upload' ? (
          <p className="m-0 type-body text-ink-2">{t`Choose your voice recording from the library in Sources after saving the brief.`}</p>
        ) : null}
      </PageSection>
    </fieldset>
  );
}
