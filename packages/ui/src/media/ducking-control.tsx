// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: ducking control · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the music under the voice, in the voiceover card: a switch that lowers the music while the voice speaks, how far
 *   the voice sits above it as measured ("Voice 9 LU above music"), and the margin to keep (6 to 20 LU) with a
 *   minus and a plus; each change is music.setDucking (free, one ⌘Z each)
 * states: default · hover/active/focus-visible (Switch, Button) · disabled (no app actions; minus at 6, plus at 20;
 *   the margin while ducking is off) · loading (the control whose change is on its way) · error (the cause under it,
 *   the switch back where it was) · success (the new value is the answer)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, DuckingSettings, ProjectId, TimelineId } from '@taalcut/core';
import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { Button } from '#components/button';
import { Switch } from '#components/switch';
import { DUCKING_MARGIN, SET_DUCKING } from './media-commands';
import { MediaError } from './media-lines';
import { useCommand } from './use-command';

export interface DuckingControlProps {
  projectId: ProjectId;
  timelineId: TimelineId;
  /** The card's snapshot: on or off, and the margin measured on the last mix. */
  measured: NonNullable<CardOf<'voiceover'>['ducking']>;
  /** The timeline's settings now; undefined until it loads (the margin waits for it). */
  live: DuckingSettings | undefined;
}

export function DuckingControl({ projectId, timelineId, measured, live }: DuckingControlProps) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const labelId = useId();
  const enabled = live?.enabled ?? measured.enabled;
  const margin = live?.marginLu;
  const off = !command.can;
  const set = (key: string, ducking: Partial<DuckingSettings>) =>
    command.run(key, SET_DUCKING, { projectId, timelineId, ducking });
  const lu = (value: number) => {
    const amount = i18n.number(value, { maximumFractionDigits: 1 });
    return t`${amount} LU`;
  };
  const measuredLu = measured.minMarginLu === null ? null : lu(measured.minMarginLu);

  return (
    <div role="group" data-slot="ducking" aria-labelledby={labelId} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          aria-labelledby={labelId}
          disabled={off}
          loading={command.busy === 'enabled'}
          invalid={command.error?.key === 'enabled'}
          onCheckedChange={(checked) => void set('enabled', { enabled: checked })}
        />
        <div className="flex min-w-0 flex-col">
          <span id={labelId} className="text-sm font-semibold text-ink">
            {t`Lower the music while the voice speaks`}
          </span>
          {measuredLu !== null ? (
            <span className="text-xs text-ink-2 tabular-nums">{t`Voice ${measuredLu} above music`}</span>
          ) : null}
        </div>
      </div>
      {margin !== undefined ? (
        <div className="flex flex-wrap items-center gap-2 ps-14">
          <span className="text-xs text-ink-2">{t`Keep the voice above the music by`}</span>
          <div role="group" aria-label={t`Margin`} className="flex items-center gap-1">
            <Button
              size="icon"
              variant="secondary"
              className="size-8"
              aria-label={t`Smaller margin`}
              disabled={off || !enabled || margin <= DUCKING_MARGIN.min}
              loading={command.busy === 'less'}
              onClick={() =>
                void set('less', { marginLu: Math.max(DUCKING_MARGIN.min, Math.round(margin) - 1) })
              }
            >
              <Minus aria-hidden />
            </Button>
            <output
              data-slot="margin"
              className="min-w-14 text-center text-sm font-semibold text-ink tabular-nums"
            >
              {lu(margin)}
            </output>
            <Button
              size="icon"
              variant="secondary"
              className="size-8"
              aria-label={t`Bigger margin`}
              disabled={off || !enabled || margin >= DUCKING_MARGIN.max}
              loading={command.busy === 'more'}
              onClick={() =>
                void set('more', { marginLu: Math.min(DUCKING_MARGIN.max, Math.round(margin) + 1) })
              }
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
      {command.error ? <MediaError error={command.error.error} /> : null}
    </div>
  );
}
