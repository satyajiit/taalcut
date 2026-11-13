// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { FrameRates, RationalTime } from '@taalcut/core';
import type { AuthoredInspection } from '@taalcut/core';
import { Button, Checkbox, Input } from '@taalcut/ui';
import { useState } from 'react';
import { Field } from '../../settings/fields';
import { ObjectField, useValidatedEdit, type SaveAuthoredEdits } from './authored-fields';

export function AuthoredMotion({
  animation,
  target,
  save,
  busy,
}: {
  animation?: AuthoredInspection['animations'][number];
  target: string;
  save: SaveAuthoredEdits;
  busy: boolean;
}) {
  const { t } = useLingui();
  const [at, setAt] = useState(animation ? RationalTime.toSeconds(animation.at) : 0);
  const [duration, setDuration] = useState(animation ? RationalTime.toSeconds(animation.duration) : 1);
  const [ease, setEase] = useState(animation?.ease ?? 'power2.inOut');
  const [from, setFrom] = useState(JSON.stringify(animation?.from ?? {}, null, 2));
  const [to, setTo] = useState(JSON.stringify(animation?.to ?? {}, null, 2));
  const validation = useValidatedEdit(save);
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void validation.run(() => [
            {
              kind: 'tween',
              target,
              ...(animation ? { animationId: animation.id } : {}),
              method: animation?.method ?? (Object.keys(JSON.parse(from)).length ? 'fromTo' : 'to'),
              at: { value: Math.round(at * 60), rate: FrameRates.fps60 },
              duration: { value: Math.round(duration * 60), rate: FrameRates.fps60 },
              ease,
              from: JSON.parse(from),
              to: JSON.parse(to),
            },
          ]);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field htmlFor="motion-start" label={t`Start (seconds)`}>
            <Input
              id="motion-start"
              type="number"
              min={0}
              step={0.01}
              value={at}
              onChange={(event) => setAt(event.target.valueAsNumber)}
            />
          </Field>
          <Field htmlFor="motion-duration" label={t`Length (seconds)`}>
            <Input
              id="motion-duration"
              type="number"
              min={animation?.method === 'set' ? 0 : 0.01}
              step={0.01}
              value={duration}
              onChange={(event) => setDuration(event.target.valueAsNumber)}
            />
          </Field>
        </div>
        <Field htmlFor="motion-ease" label={t`Easing`}>
          <Input id="motion-ease" value={ease} onChange={(event) => setEase(event.target.value)} />
        </Field>
        <ObjectField id="motion-from" label={t`Start values (JSON)`} value={from} onChange={setFrom} />
        <ObjectField id="motion-to" label={t`End values (JSON)`} value={to} onChange={setTo} />
        {validation.error}
        <Button type="submit" disabled={busy}>
          {animation ? t`Save motion` : t`Add motion`}
        </Button>
        {animation ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void save([{ kind: 'removeTween', animationId: animation.id }])}
          >{t`Remove motion`}</Button>
        ) : null}
      </form>
      {animation ? <AdvancedMotion animation={animation} save={save} busy={busy} /> : null}
    </div>
  );
}

function AdvancedMotion({
  animation,
  save,
  busy,
}: {
  animation: AuthoredInspection['animations'][number];
  save: SaveAuthoredEdits;
  busy: boolean;
}) {
  const { t } = useLingui();
  const animationId = animation.id;
  const [position, setPosition] = useState(animation.keyframes?.[0]?.position ?? 50);
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState(JSON.stringify(animation.keyframes?.[0]?.values ?? {}, null, 2));
  const [segments, setSegments] = useState(JSON.stringify(animation.path?.segments ?? [], null, 2));
  const [rotate, setRotate] = useState(Boolean(animation.path?.autoRotate));
  const validation = useValidatedEdit(save);
  return (
    <>
      <details className="flex flex-col gap-4">
        <summary className="cursor-pointer type-label text-ink">{t`Keyframes`}</summary>
        <div className="mt-4 flex flex-col gap-3">
          <Field htmlFor="keyframe-index" label={t`Keyframe index`}>
            <Input
              id="keyframe-index"
              type="number"
              min={0}
              step={1}
              value={index}
              onChange={(event) => {
                const next = event.target.valueAsNumber;
                setIndex(next);
                const frame = animation.keyframes?.[next];
                setPosition(frame?.position ?? 50);
                setValues(JSON.stringify(frame?.values ?? {}, null, 2));
              }}
            />
          </Field>
          <Field htmlFor="keyframe-position" label={t`Position (%)`}>
            <Input
              id="keyframe-position"
              type="number"
              min={0}
              max={100}
              value={position}
              onChange={(event) => setPosition(event.target.valueAsNumber)}
            />
          </Field>
          <ObjectField id="keyframe-values" label={t`Values (JSON)`} value={values} onChange={setValues} />
          <Button
            disabled={busy}
            onClick={() =>
              void validation.run(() => [
                { kind: 'keyframe', animationId, index, position, values: JSON.parse(values) },
              ])
            }
          >{t`Save keyframe`}</Button>
          {animation.keyframes?.[index] ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void save([
                  { kind: 'removeKeyframe', animationId, position: animation.keyframes![index]!.position },
                ])
              }
            >{t`Remove keyframe`}</Button>
          ) : null}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer type-label text-ink">{t`Motion path`}</summary>
        <div className="mt-4 flex flex-col gap-3">
          <ObjectField
            id="path-segments"
            label={t`Bezier control points (JSON)`}
            value={segments}
            onChange={setSegments}
          />
          <Checkbox label={t`Rotate along the path`} checked={rotate} onCheckedChange={setRotate} />
          <Button
            disabled={busy}
            onClick={() =>
              void validation.run(() => [
                { kind: 'path', animationId, autoRotate: rotate, segments: JSON.parse(segments) },
              ])
            }
          >{t`Save path`}</Button>
          {animation.path ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void save([{ kind: 'removePath', animationId }])}
            >{t`Remove path`}</Button>
          ) : null}
        </div>
      </details>
      {validation.error}
    </>
  );
}
