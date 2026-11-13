// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, RationalTime, type Timeline } from '@taalcut/core';
import { Button, Input } from '@taalcut/ui';
import { useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { Field } from '../../settings/fields';

export function AuthoredRange({ timeline, paused }: { timeline: Timeline; paused: boolean }) {
  const { t } = useLingui();
  const command = useCommand();
  const first = timeline.tracks[0];
  const track = first?.kind === 'video' ? first : undefined;
  const item = track?.items.find((entry) => entry.type === 'program');
  const index = item ? track!.items.indexOf(item) : -1;
  const placement =
    track?.items
      .slice(0, index)
      .reduce(
        (sum, entry) => sum + (entry.type === 'transition' ? 0 : RationalTime.toSeconds(entry.duration)),
        0,
      ) ?? 0;
  const [start, setStart] = useState(placement);
  const [sourceStart, setSourceStart] = useState(item ? RationalTime.toSeconds(item.sourceStart) : 0);
  const [duration, setDuration] = useState(item ? RationalTime.toSeconds(item.duration) : 1);
  if (
    !item ||
    track?.kind !== 'video' ||
    track.items.some((entry) => entry.id !== item.id && entry.type !== 'gap')
  )
    return null;
  const valid =
    [start, sourceStart, duration].every(Number.isFinite) && start >= 0 && sourceStart >= 0 && duration > 0;
  const fields = [
    { id: 'program-placement', label: t`Video starts at (seconds)`, value: start, set: setStart, min: 0 },
    {
      id: 'program-in-point',
      label: t`Video source in-point (seconds)`,
      value: sourceStart,
      set: setSourceStart,
      min: 0,
    },
    {
      id: 'program-duration',
      label: t`Video length (seconds)`,
      value: duration,
      set: setDuration,
      min: 0.01,
    },
  ];
  return (
    <details>
      <summary className="cursor-pointer type-label text-ink">{t`Video trim & placement`}</summary>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || paused) return;
          const time = (seconds: number) => RationalTime.fromSeconds(seconds, timeline.canvas.rate);
          void command.run({
            name: CREATION_COMMANDS.setProgramRange,
            payload: {
              projectId: timeline.projectId,
              timelineId: timeline.id,
              revision: timeline.revision,
              itemId: item.id,
              start: time(start),
              sourceStart: time(sourceStart),
              duration: time(duration),
            },
          });
        }}
      >
        <p className="m-0 type-meta text-ink-2">{t`These controls move and trim the video. Adjust voice and music separately in their audio tracks.`}</p>
        {fields.map((field) => (
          <Field key={field.id} htmlFor={field.id} label={field.label}>
            <Input
              id={field.id}
              type="number"
              min={field.min}
              step={0.01}
              value={field.value}
              disabled={paused || command.pending}
              onChange={(event) => field.set(event.target.valueAsNumber)}
            />
          </Field>
        ))}
        <Button
          type="submit"
          disabled={paused || !valid}
          loading={command.pending}
        >{t`Save video range`}</Button>
      </form>
    </details>
  );
}
