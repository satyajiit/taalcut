// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the music section's mix rows · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · two hairline-separated rows under the music choice: "Lower the music under the voice"
 *   (a switch on music.setDucking, shown when someone speaks and music is in the file; its margin in LU) and
 *   "Hits on the cuts" (a switch that takes the effects out with sfx.setHits, Undo in the toast, and puts them
 *   back while that is still the newest change; without hits, "Add hits on the cuts…" asks Taalcut in the chat)
 * states: default · hover/focus/active (switches, the button) · disabled (while the export starts; putting back
 *   once something newer happened, with why) · loading (the switch while it saves) · error (the cause in one
 *   line) · success (silent: the switch moved; taking out says so in a toast with Undo)
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MIX_COMMANDS, type TaalcutError } from '@taalcut/core';
import { ErrorLine, LabelledSwitch } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { AskRow, SectionNote } from './section-frame';
import { hasVoice, hitCount } from './timeline-facts';
import type { SectionProps } from './types';
import { useTakeOut } from './use-take-out';

function Ducking({ context, dispatch, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const { timeline, projectId, timelineId } = context;
  const ducking = timeline.mix.ducking;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    const result = await dispatch(MIX_COMMANDS.setDucking, { projectId, timelineId, ducking: { enabled } });
    setSaving(false);
    if (!result.ok) setError(result.error);
  };
  const margin = i18n.number(ducking.marginLu, { maximumFractionDigits: 1 });
  return (
    <div data-slot="ducking" className="flex flex-col gap-1">
      <LabelledSwitch
        checked={ducking.enabled}
        disabled={disabled}
        loading={saving}
        onChange={(enabled) => void toggle(enabled)}
      >
        {t`Lower the music under the voice`}
      </LabelledSwitch>
      <SectionNote className="ps-11 tabular-nums">
        {ducking.enabled
          ? t`The voice stays at least ${margin} LU above the music.`
          : t`The music plays at one level, voice or not.`}
      </SectionNote>
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}

function Hits({ context, ask, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const { timeline, projectId, timelineId } = context;
  const count = hitCount(timeline);
  const [had, setHad] = useState(count > 0);
  const takeOut = useTakeOut(projectId);
  useEffect(() => {
    if (count > 0) setHad(true);
  }, [count]);

  if (!had)
    return (
      <AskRow
        label={t`Hits on the cuts`}
        note={t`Sound effects that land on each cut, made in the chat.`}
        action={t`Add hits…`}
        disabled={disabled}
        onAsk={() => ask(t`Add hits on the cuts.`)}
      />
    );
  const on = count > 0;
  const toggle = (next: boolean) =>
    void (next
      ? takeOut.back(MIX_COMMANDS.setHits)
      : takeOut.out({
          name: MIX_COMMANDS.setHits,
          payload: { projectId, timelineId, hits: [] },
          done: t`Took the hits off the cuts`,
          failed: t`Couldn’t take the hits off`,
        }));
  return (
    <div data-slot="hits" className="flex flex-col gap-1">
      <LabelledSwitch
        checked={on}
        disabled={disabled || (!on && !takeOut.canPutBack)}
        loading={takeOut.pending !== null}
        onChange={toggle}
      >
        {t`Hits on the cuts`}
      </LabelledSwitch>
      <SectionNote className="ps-11 tabular-nums">
        {on
          ? i18n._(msg`${plural(count, { one: '# sound, on a cut.', other: '# sounds, each on a cut.' })}`)
          : takeOut.canPutBack
            ? t`Taken out. Turn it back on to put them back.`
            : t`Something changed since. Ask Taalcut to add them again.`}
      </SectionNote>
      {takeOut.error ? <ErrorLine error={takeOut.error} /> : null}
    </div>
  );
}

/** The mix under the music choice: ducking when someone speaks over music in the file, and the hits. */
export function MixRows(props: SectionProps) {
  const { timeline, options } = props.context;
  const ducks =
    hasVoice(timeline) &&
    options.music.current.path !== 'platformSound' &&
    options.music.current.path !== 'none';
  return (
    <div className="flex flex-col gap-3 border-t border-rule-subtle pt-3">
      {ducks ? <Ducking {...props} /> : null}
      <Hits {...props} />
    </div>
  );
}
