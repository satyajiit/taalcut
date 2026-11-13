// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { FrameRates, RationalTime } from '@taalcut/core';
import type { AuthoredInspection } from '@taalcut/core';
import { Button, Input } from '@taalcut/ui';
import { useState } from 'react';
import { CreationText } from '../../create/create-fields';
import { Field } from '../../settings/fields';
import { ObjectField, useValidatedEdit, type SaveAuthoredEdits } from './authored-fields';
import { authoredLayerEdits } from './authored-layer-edits';

export function AuthoredLayer({
  element,
  save,
  busy,
}: {
  element: AuthoredInspection['elements'][number];
  save: SaveAuthoredEdits;
  busy: boolean;
}) {
  const { t } = useLingui();
  const [text, setText] = useState(element.text ?? '');
  const [styles, setStyles] = useState(JSON.stringify(element.styles, null, 2));
  const [attributes, setAttributes] = useState(JSON.stringify(element.attributes, null, 2));
  const [order, setOrder] = useState(Number(element.styles['z-index'] ?? 0));
  const [start, setStart] = useState(element.start ? RationalTime.toSeconds(element.start) : 0);
  const [duration, setDuration] = useState(element.duration ? RationalTime.toSeconds(element.duration) : 1);
  const validation = useValidatedEdit(save);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void validation.run(() => authoredLayerEdits(element, { text, styles, attributes, order }));
      }}
    >
      {element.text !== null ? (
        <Field htmlFor="authored-text" label={t`Text`}>
          <CreationText id="authored-text" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
      ) : null}
      <ObjectField
        id="authored-styles"
        label={t`Style properties (JSON)`}
        value={styles}
        onChange={setStyles}
      />
      <ObjectField
        id="authored-attributes"
        label={t`Attributes (JSON)`}
        value={attributes}
        onChange={setAttributes}
      />
      <Field htmlFor="authored-order" label={t`Layer order`}>
        <Input
          id="authored-order"
          type="number"
          step={1}
          value={order}
          onChange={(event) => setOrder(event.target.valueAsNumber)}
        />
      </Field>
      {validation.error}
      <Button type="submit" disabled={busy}>{t`Save layer`}</Button>
      <div className="grid grid-cols-2 gap-3">
        <Field htmlFor="authored-start" label={t`Start (seconds)`}>
          <Input
            id="authored-start"
            type="number"
            step={0.01}
            min={0}
            value={start}
            onChange={(event) => setStart(event.target.valueAsNumber)}
          />
        </Field>
        <Field htmlFor="authored-duration" label={t`Length (seconds)`}>
          <Input
            id="authored-duration"
            type="number"
            step={0.01}
            min={0.01}
            value={duration}
            onChange={(event) => setDuration(event.target.valueAsNumber)}
          />
        </Field>
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          void validation.run(() => [
            {
              kind: 'timing',
              target: element.id,
              start: { value: Math.round(start * 60), rate: FrameRates.fps60 },
              duration: { value: Math.round(duration * 60), rate: FrameRates.fps60 },
            },
          ])
        }
      >{t`Save timing`}</Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void save([{ kind: 'remove', target: element.id }])}
      >{t`Remove layer`}</Button>
    </form>
  );
}

export function AddAuthoredLayer({
  parent,
  save,
  busy,
}: {
  parent: string | null;
  save: SaveAuthoredEdits;
  busy: boolean;
}) {
  const { t } = useLingui();
  const [html, setHtml] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await save([{ kind: 'add', parent, index: 0, html }])) setHtml('');
      }}
    >
      <Field htmlFor="authored-add" label={t`New layer HTML`}>
        <CreationText
          id="authored-add"
          value={html}
          spellCheck={false}
          onChange={(event) => setHtml(event.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy || !html.trim()}>
        {parent ? t`Add inside selected layer` : t`Add layer`}
      </Button>
    </form>
  );
}
