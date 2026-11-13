// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Voice" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the voiceover as it will play: its voice's name as the provider wrote it
 *   (translate="no"), a "Your voice" chip (teal: you) for a clone of the person's own voice, else "AI voice"
 *   (violet with the AI mark), its language and lines, whether the takes are drafts; one switch, "Voiceover in
 *   the video": off takes it out (voice.removeVoiceover, Undo in the toast), on puts it back while that is still
 *   the newest change. Shown when the timeline had a voiceover as the dialog opened.
 * states: default (on) · taken out (off, how to put it back) · put back no longer possible (the switch off and
 *   disabled, why) · hover/focus/active (the switch) · disabled (while the export starts) · loading (the switch
 *   while it saves) · error (the cause in one line) · success (silent; taking out says so in a toast with Undo)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { VOICE_COMMANDS, type Voiceover } from '@taalcut/core';
import { AiMark, Chip, ErrorLine, LabelledSwitch, UserContent } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { formatLanguage } from '../../shared/format';
import { SectionFrame, SectionNote } from './section-frame';
import type { ExportSection, SectionProps } from './types';
import { useTakeOut } from './use-take-out';

function VoiceLine({ voiceover }: { voiceover: Voiceover }) {
  const { t, i18n } = useLingui();
  const drafts = voiceover.lines.filter((line) => line.quality === 'draft').length;
  const lines = i18n._(msg`${plural(voiceover.lines.length, { one: '# line', other: '# lines' })}`);
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 flex flex-wrap items-center gap-2 type-body text-ink">
        <UserContent className="font-medium">{voiceover.voiceName}</UserContent>
        {voiceover.own ? (
          <Chip tone="you">{t`Your voice`}</Chip>
        ) : (
          <Chip tone="ai">
            <AiMark className="size-3" />
            {t`AI voice`}
          </Chip>
        )}
      </p>
      <SectionNote className="tabular-nums">
        {formatLanguage(i18n, voiceover.language)} · {lines}
        {drafts > 0 ? ` · ${t`draft takes`}` : null}
      </SectionNote>
    </div>
  );
}

function Voice({ context, disabled }: SectionProps) {
  const { t } = useLingui();
  const { timeline, projectId, timelineId } = context;
  // The voiceover as it was, so the section still says what it was once it's taken out.
  const [last, setLast] = useState<Voiceover | null>(timeline.voiceover);
  const takeOut = useTakeOut(projectId);
  useEffect(() => {
    if (timeline.voiceover) setLast(timeline.voiceover);
  }, [timeline.voiceover]);
  if (!last) return null;
  const on = timeline.voiceover !== null;
  const toggle = (next: boolean) =>
    void (next
      ? takeOut.back(VOICE_COMMANDS.removeVoiceover)
      : takeOut.out({
          name: VOICE_COMMANDS.removeVoiceover,
          payload: { projectId, timelineId, revision: timeline.revision },
          done: t`Took the voiceover out`,
          failed: t`Couldn’t take the voiceover out`,
        }));

  return (
    <SectionFrame id="voice" title={t`Voice`}>
      <VoiceLine voiceover={last} />
      <LabelledSwitch
        checked={on}
        disabled={disabled || (!on && !takeOut.canPutBack)}
        loading={takeOut.pending !== null}
        onChange={toggle}
      >
        {t`Voiceover in the video`}
      </LabelledSwitch>
      {on ? null : (
        <SectionNote>
          {takeOut.canPutBack
            ? t`Taken out: the files stay in your library.`
            : t`Something changed since. Ask Taalcut to add the voiceover again.`}
        </SectionNote>
      )}
      {takeOut.error ? <ErrorLine error={takeOut.error} /> : null}
    </SectionFrame>
  );
}

export const voiceSection: ExportSection = {
  id: 'voice',
  available: ({ timeline }) => timeline.voiceover !== null,
  Component: Voice,
};
