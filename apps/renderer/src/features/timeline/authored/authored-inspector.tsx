// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, type AuthoredEdit, type Timeline } from '@taalcut/core';
import { Button, Segmented, Select } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useRpcQuery } from '../../../backend/use-rpc';
import { CreationText } from '../../create/create-fields';
import { Field, Loading, LoadError } from '../../settings/fields';
import { AuthoredLayer, AddAuthoredLayer } from './authored-layer';
import { AuthoredMotion } from './authored-motion';
import { AuthoredRange } from './authored-range';

export function AuthoredInspector({ timeline, paused = false }: { timeline: Timeline; paused?: boolean }) {
  const { t } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const [tab, setTab] = useState<'layers' | 'motion' | 'source'>('layers');
  const [selected, setSelected] = useState('');
  const [animationId, setAnimationId] = useState('');
  const inspection = useRpcQuery(
    (signal) =>
      backend.creation.inspect({ projectId: timeline.projectId, timelineId: timeline.id }, { signal }),
    [backend, timeline.id, timeline.revision],
  );
  const data = inspection.data;
  const element = data?.elements.find((entry) => entry.id === selected) ?? data?.elements[0];
  const animations =
    data?.animations.filter((animation) => !element || animation.targets.includes(element.id)) ?? [];
  const animation = animations.find((entry) => entry.id === animationId);
  const target = { projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision };
  const save = async (edits: AuthoredEdit[]) => {
    if (paused) return false;
    const result = await command.run({ name: CREATION_COMMANDS.editProgram, payload: { ...target, edits } });
    if (result.ok) inspection.reload();
    return result.ok;
  };
  return (
    <section data-slot="authored-inspector" className="flex flex-col gap-4">
      <h2 className="m-0 type-card-title text-ink">{t`Video design`}</h2>
      <AuthoredRange key={`${timeline.id}-${timeline.revision}`} timeline={timeline} paused={paused} />
      <Segmented
        label={t`Design controls`}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'layers', label: t`Layers` },
          { value: 'motion', label: t`Motion` },
          { value: 'source', label: t`Source` },
        ]}
      />
      {inspection.status === 'loading' && !data ? <Loading /> : null}
      {inspection.status === 'error' ? (
        <LoadError
          error={inspection.error}
          onRetry={inspection.reload}
          what={t`The video design didn’t load.`}
        />
      ) : null}
      {data && tab !== 'source' ? (
        <Field htmlFor="authored-layer" label={t`Layer`}>
          <Select
            id="authored-layer"
            value={element?.id ?? ''}
            onChange={(event) => {
              setSelected(event.target.value);
              setAnimationId('');
            }}
          >
            {data.elements.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {data && tab === 'layers' ? (
        <>
          {element ? (
            <AuthoredLayer
              key={`${data.program.hash}-${element.id}`}
              element={element}
              save={save}
              busy={paused || command.pending}
            />
          ) : null}
          <AddAuthoredLayer parent={element?.id ?? null} save={save} busy={paused || command.pending} />
        </>
      ) : data && tab === 'motion' && element ? (
        <>
          <Field htmlFor="authored-animation" label={t`Animation`}>
            <Select
              id="authored-animation"
              value={animation?.id ?? ''}
              onChange={(event) => setAnimationId(event.target.value)}
            >
              <option value="">{t`New animation`}</option>
              {animations.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
            </Select>
          </Field>
          <AuthoredMotion
            key={`${data.program.hash}-${element.id}-${animation?.id ?? ''}`}
            {...(animation ? { animation } : {})}
            target={element.id}
            save={save}
            busy={paused || command.pending}
          />
        </>
      ) : data && tab === 'source' ? (
        <AuthoredSource
          key={data.program.hash}
          source={data.source}
          busy={paused || command.pending}
          save={async (source) => {
            if (paused) return;
            const result = await command.run({
              name: CREATION_COMMANDS.replaceSource,
              payload: { ...target, source },
            });
            if (result.ok) inspection.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function AuthoredSource({
  source,
  busy,
  save,
}: {
  source: string;
  busy: boolean;
  save: (value: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [value, setValue] = useState(source);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(value);
      }}
    >
      <Field htmlFor="authored-source" label={t`Composition source`}>
        <CreationText
          id="authored-source"
          rows={24}
          value={value}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <Button type="submit" loading={busy} disabled={value === source}>{t`Save source revision`}</Button>
    </form>
  );
}
