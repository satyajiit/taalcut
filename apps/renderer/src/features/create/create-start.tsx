// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · mode: Operate · system: DESIGN.md · idea-first entry beside Kaatu.
 * States: empty, typing, pending, command error; shared controls retain focus and reduced-motion behavior. */

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, FrameRates, newId, type CreationBrief } from '@taalcut/core';
import { Button, Kaatu, Select, VERB_ICONS } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../backend/use-command';
import { Field } from '../settings/fields';
import { CreationText } from './create-fields';

export function initialCreationBrief(
  category: CreationBrief['category'],
  language: string,
  prompt = '',
): CreationBrief {
  const idea = prompt.trim();
  const firstLine = idea.split(/\r?\n/u)[0] ?? '';
  let title = '';
  for (const character of firstLine) {
    if (title.length + character.length > 200) break;
    title += character;
  }
  return {
    category,
    title,
    prompt: idea,
    audience: '',
    callToAction: '',
    formats: ['16:9'],
    duration: { value: 5400, rate: FrameRates.fps60 },
    voice: { mode: 'none', voiceId: null, assetId: null, language },
  };
}

export function CreationStart() {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState<CreationBrief['category']>('product-launch');
  return (
    <section className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] items-center gap-5 border-b border-rule-subtle pb-5 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1fr)] xl:gap-8 xl:pb-8">
      <div className="flex items-center gap-3 xl:gap-5">
        <Kaatu spot="empty" />
        <div className="flex min-w-0 flex-col gap-2 xl:gap-3">
          <h2 className="m-0 type-section text-balance text-ink xl:type-page-title">{t`Start with the story you want to tell.`}</h2>
          <p className="m-0 max-w-prose type-meta text-ink-2 xl:type-body">{t`Turn an idea, a website or a project into a video you can keep editing.`}</p>
        </div>
      </div>
      <form
        className="flex min-w-0 flex-col gap-3 xl:gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!prompt.trim() || command.pending) return;
          const projectId = newId<'Project'>();
          const result = await command.run({
            name: CREATION_COMMANDS.create,
            payload: { projectId, brief: initialCreationBrief(category, i18n.locale, prompt) },
          });
          if (result.ok) await navigate({ to: '/create/$projectId', params: { projectId } });
        }}
      >
        <Field htmlFor="create-idea" label={t`Your video idea`}>
          <CreationText
            id="create-idea"
            className="min-h-24 p-3 type-body xl:min-h-32 xl:p-4 xl:type-prose"
            placeholder={t`What would you like to make?`}
            required
            maxLength={12000}
            value={prompt}
            disabled={command.pending}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-end justify-between gap-3 xl:gap-4">
          <Field htmlFor="create-start-category" label={t`Category`} className="min-w-40 flex-1">
            <Select
              id="create-start-category"
              value={category}
              disabled={command.pending}
              onChange={(event) => setCategory(event.target.value as CreationBrief['category'])}
            >
              <option value="product-launch">{t`Product launch`}</option>
              <option value="custom">{t`Write your own`}</option>
            </Select>
          </Field>
          <Button
            type="submit"
            variant="primary"
            icon={VERB_ICONS.makeVideo}
            loading={command.pending}
            disabled={!prompt.trim()}
          >{t`Start video`}</Button>
        </div>
      </form>
    </section>
  );
}
