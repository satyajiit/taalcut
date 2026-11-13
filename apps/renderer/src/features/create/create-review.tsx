// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, type CreationDraft, type CreationProject } from '@taalcut/core';
import {
  AnimatePresence,
  Button,
  CONCEPT_ICONS,
  DUR,
  EASE_OUT,
  Input,
  PageSection,
  REDUCED_FADE,
  Segmented,
  UserContent,
  VERB_ICONS,
  motion,
  useReducedMotion,
} from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useCommand } from '../../backend/use-command';
import { Field } from '../settings/fields';
import { CreationText } from './create-fields';
import { CreationScene } from './create-scene';

export function CreationResearch({ project, onChange }: { project: CreationProject; onChange: () => void }) {
  const { t } = useLingui();
  const command = useCommand();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = project.draft?.questions ?? [];
  return (
    <div className="flex flex-col gap-8">
      <PageSection title={t`What Taalcut found`} icon={CONCEPT_ICONS.search}>
        {project.sources.length === 0 ? (
          <p className="m-0 type-body text-ink-2">{t`Your brief is the source for this video. Add links or folders to ground it in more detail.`}</p>
        ) : null}
        {project.sources.map((source) => (
          <article
            key={source.id}
            className="flex flex-col gap-2 border-b border-rule-subtle pb-5 last:border-0 last:pb-0"
          >
            <h3 className="m-0 type-card-title text-ink">
              <UserContent>{source.label}</UserContent>
            </h3>
            <p className="m-0 type-meta text-ink-2">
              {source.status === 'ready'
                ? t`Read`
                : source.status === 'failed'
                  ? t`Couldn’t read this source`
                  : t`Waiting to read`}
            </p>
            {source.evidence.map((entry, index) => (
              <div key={index} className="border-s border-rule ps-4">
                <UserContent className="block whitespace-pre-wrap type-body text-ink">
                  {entry.summary}
                </UserContent>
                <UserContent className="block break-all type-meta text-ink-2">{entry.locator}</UserContent>
              </div>
            ))}
          </article>
        ))}
      </PageSection>
      {questions.length ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!project.draft) return;
            const result = await command.run({
              name: CREATION_COMMANDS.answer,
              payload: {
                projectId: project.projectId,
                revision: project.revision,
                draftRevision: project.draft.revision,
                answers: questions.map((question) => ({
                  id: question.id,
                  answer: answers[question.id] ?? question.answer ?? '',
                })),
              },
            });
            if (result.ok) onChange();
          }}
        >
          <h2 className="m-0 type-section text-ink">{t`A few details to settle`}</h2>
          {questions.map((question) => (
            <Field
              key={question.id}
              htmlFor={`answer-${question.id}`}
              label={<UserContent>{question.prompt}</UserContent>}
            >
              <Input
                id={`answer-${question.id}`}
                required={question.required}
                maxLength={4000}
                value={answers[question.id] ?? question.answer ?? ''}
                onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
              />
            </Field>
          ))}
          <Button
            type="submit"
            icon={VERB_ICONS.approve}
            className="self-start"
            loading={command.pending}
          >{t`Save answers`}</Button>
        </form>
      ) : null}
    </div>
  );
}

export function CreationDraftEditor({
  project,
  design = false,
  onChange,
  onDirty,
}: {
  project: CreationProject;
  design?: boolean;
  onChange: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const [draft, setDraft] = useState<CreationDraft | null>(project.draft);
  const [sceneId, setSceneId] = useState(project.draft?.beats[0]?.id ?? '');
  const reduce = useReducedMotion();
  const dirty = JSON.stringify(draft) !== JSON.stringify(project.draft);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  if (!draft)
    return (
      <p className="m-0 type-body text-ink-2">{t`Research your brief and sources to prepare the script and visual direction.`}</p>
    );
  const locked = project.status === 'producing' || project.status === 'researching';
  const active = draft.beats.find((entry) => entry.id === sceneId) ?? draft.beats[0];
  const beat = (id: string, change: Partial<CreationDraft['beats'][number]>) =>
    setDraft({
      ...draft,
      beats: draft.beats.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    });
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await command.run({
          name: CREATION_COMMANDS.updateDraft,
          payload: {
            projectId: project.projectId,
            revision: project.revision,
            draftRevision: project.draft?.revision,
            draft,
          },
        });
        if (result.ok) onChange();
      }}
    >
      <PageSection
        title={design ? t`Shape the visual direction` : t`Refine your story`}
        icon={design ? CONCEPT_ICONS.brandKit : CONCEPT_ICONS.text}
        description={
          design ? undefined : t`Edit the words and timing. Changes create a new draft for you to approve.`
        }
      >
        {design ? (
          <Field htmlFor="create-direction" label={t`Visual direction`}>
            <CreationText
              id="create-direction"
              className="min-h-24"
              value={draft.visualDirection}
              disabled={locked}
              onChange={(event) => setDraft({ ...draft, visualDirection: event.target.value })}
            />
          </Field>
        ) : null}
        <div className="border-y border-rule-subtle py-4">
          <Segmented
            label={t`Scenes`}
            value={active?.id ?? null}
            options={draft.beats.map((entry, index) => {
              const sceneNumber = i18n.number(index + 1);
              return { value: entry.id, label: t`Scene ${sceneNumber}` };
            })}
            onChange={setSceneId}
          />
        </div>
        <AnimatePresence initial={false} mode="wait">
          {active ? (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
            >
              <CreationScene
                entry={active}
                index={draft.beats.indexOf(active)}
                design={design}
                disabled={locked || command.pending}
                onChange={(change) => beat(active.id, change)}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </PageSection>
      <Button
        type="submit"
        className="self-start"
        icon={VERB_ICONS.approve}
        disabled={locked}
        loading={command.pending}
      >{t`Save draft changes`}</Button>
    </form>
  );
}
