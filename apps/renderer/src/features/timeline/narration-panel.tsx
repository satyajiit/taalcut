// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { RationalTime, SIMPLE_EDITOR_COMMANDS as N, type Timeline } from '@taalcut/core';
import { Button, ErrorLine, useTimecode } from '@taalcut/ui';
import { useState } from 'react';
import { useNarrationRecorder } from '../voice/use-narration-recorder';
import type { Playhead } from './playhead';
import type { Edits } from './use-edits';

export function NarrationPanel({
  timeline,
  playhead,
  edits,
}: {
  timeline: Timeline;
  playhead: Playhead;
  edits: Edits;
}) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const recorder = useNarrationRecorder(timeline.projectId);
  const [capture, setCapture] = useState({
    at: playhead.frame(),
    revision: timeline.revision,
    rate: timeline.canvas.rate,
  });
  const { at } = capture;
  const active = ['countdown', 'opening', 'recording', 'stopping'].includes(recorder.phase);
  const countdown = i18n.number(recorder.count);
  return (
    <section className="flex flex-col gap-3 border-b border-rule-subtle p-4" aria-label={t`Record voice`}>
      <h2 className="m-0 type-card-title">{t`Record your own narration`}</h2>
      <p className="m-0 type-meta text-ink-2">{t`The take starts at the playhead position captured when you press Record voice. Recording stops at the end of the video.`}</p>
      {recorder.permission === 'denied' || recorder.permission === 'restricted' ? (
        <p
          role="status"
          className="m-0 type-meta"
        >{t`Allow microphone access in your computer’s privacy settings, then try Record voice again.`}</p>
      ) : null}
      {recorder.error ? <ErrorLine error={recorder.error} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!active && !recorder.take ? (
          <Button
            size="sm"
            disabled={edits.pending || playhead.frame() >= playhead.total() - 1}
            onClick={() => {
              setCapture({ at: playhead.frame(), revision: timeline.revision, rate: timeline.canvas.rate });
              playhead.pause();
              void recorder.start(
                ((playhead.total() - playhead.frame()) * timeline.canvas.rate.den * 1000) /
                  timeline.canvas.rate.num,
              );
            }}
          >{t`Record voice`}</Button>
        ) : null}
        {recorder.phase === 'countdown' ? (
          <span role="status" className="type-card-title">{t`Starting in ${countdown}…`}</span>
        ) : null}
        {recorder.phase === 'opening' ? <span role="status">{t`Opening microphone…`}</span> : null}
        {recorder.phase === 'recording' ? (
          <>
            <meter min={0} max={1} value={recorder.level} aria-label={t`Microphone level`} className="w-32" />
            <span className="type-meta tabular-nums">
              {time.clock(Math.floor(recorder.elapsed), { num: 1000, den: 1 })}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void recorder.stop()}
            >{t`Stop recording`}</Button>
          </>
        ) : null}
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={recorder.phase === 'stopping'}
            onClick={() => void recorder.reset()}
          >{t`Cancel recording`}</Button>
        ) : null}
        {recorder.phase === 'stopping' ? <span role="status">{t`Saving take…`}</span> : null}
      </div>
      {recorder.take ? (
        <div className="flex flex-wrap items-center gap-3">
          {capture.revision !== timeline.revision ? (
            <p
              role="status"
              className="m-0 type-meta"
            >{t`The video changed. Your take is kept. Use it at the original position or record again.`}</p>
          ) : null}
          <audio
            controls
            src={recorder.take.url}
            aria-label={t`Play recorded take`}
            className="h-9 max-w-full"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={edits.pending}
            onClick={() => void recorder.reset()}
          >{t`Retake`}</Button>
          <Button
            size="sm"
            disabled={edits.pending}
            onClick={async () => {
              const done = await edits.command(N.addNarration, {
                captureKey: recorder.take!.captureKey,
                at: RationalTime.of(at, capture.rate),
                revision: timeline.revision,
              });
              if (done.ok) await recorder.reset();
            }}
          >
            {capture.revision !== timeline.revision ? t`Use at original position` : t`Use recording`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
