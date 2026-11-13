// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Make it vertical" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · how many clips were shot in another shape and are framed for this one; "Smart
 *   reframe" on follows the person in each (timeline.setReframe mode auto), off holds a still centre crop
 *   (mode centre), one command per clip; a clip someone framed by hand (the whole shot on a blurred pad) keeps
 *   its framing either way; "Review in the editor" opens the first reframed clip.
 * states: default (on) · off · mixed (on, with how many follow) · hover/focus/active (the switch, the button) ·
 *   disabled (while the export starts) · loading (the switch while each clip saves) · error (the cause in one
 *   line; clips already changed stay changed, each with its own undo) · success (silent: the switch moved)
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { TIMELINE_COMMANDS, type Clip, type ReframeMode, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, LabelledSwitch } from '@taalcut/ui';
import { useState } from 'react';
import { SectionFrame, SectionNote } from './section-frame';
import { follows, reframedClips, videoClipCount } from './timeline-facts';
import type { ExportSection, SectionProps } from './types';

function Reframe({ context, dispatch, review, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const { timeline, projectId, timelineId } = context;
  const clips = reframedClips(timeline);
  const following = clips.filter(follows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const first = clips[0];
  if (!first) return null;

  const set = async (from: (clip: Clip) => boolean, mode: ReframeMode) => {
    setSaving(true);
    setError(null);
    try {
      for (const clip of clips.filter(from)) {
        if (!clip.reframe) continue;
        const result = await dispatch(TIMELINE_COMMANDS.setReframe, {
          projectId,
          timelineId,
          clipId: clip.id,
          reframe: { ...clip.reframe, mode },
        });
        if (!result.ok) return setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  };
  const toggle = (on: boolean) =>
    void (on
      ? set((clip) => clip.reframe?.mode === 'centre', 'auto')
      : set((clip) => follows(clip), 'centre'));

  const reframed = i18n._(
    msg`${plural(clips.length, {
      one: '# clip was shot in another shape and is framed for this one.',
      other: '# clips were shot in another shape and are framed for this one.',
    })}`,
  );
  const total = videoClipCount(timeline);
  const followCount = i18n.number(following.length);
  const clipCount = i18n.number(clips.length);
  const of = t`${followCount} of ${clipCount} follow the person in them.`;
  return (
    <SectionFrame
      id="reframe"
      title={t`Make it vertical`}
      aside={
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => review(first.id)}>
          {t`Review in the editor`}
        </Button>
      }
    >
      <SectionNote className="tabular-nums">
        {reframed} {total > clips.length ? t`The other clips already fit.` : null}
      </SectionNote>
      <LabelledSwitch checked={following.length > 0} disabled={disabled} loading={saving} onChange={toggle}>
        {t`Smart reframe`}
      </LabelledSwitch>
      <SectionNote className="ps-11 tabular-nums">
        {following.length === 0
          ? t`Off: a still crop from the middle of each shot.`
          : following.length === clips.length
            ? t`Follows the person in each shot, clear of the app’s buttons and the captions.`
            : of}
      </SectionNote>
      {error ? <ErrorLine error={error} /> : null}
    </SectionFrame>
  );
}

export const reframeSection: ExportSection = {
  id: 'reframe',
  available: ({ timeline }) => reframedClips(timeline).length > 0,
  Component: Reframe,
};
