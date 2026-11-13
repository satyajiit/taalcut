// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { SIMPLE_EDITOR_COMMANDS as N, type Timeline, type TranscriptOccurrence } from '@taalcut/core';
import { Button, ErrorLine, useTimecode } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import type { Playhead } from './playhead';
import type { Edits } from './use-edits';
import { CaptionSearch } from './caption-search';

const wordKey = (word: TranscriptOccurrence) => `${word.clipId}:${word.segment}:${word.word}`;

export function WordsPanel({
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
  const backend = useBackend();
  const [mode, setMode] = useState<'speech' | 'captions'>('speech');
  const words = useRpcQuery(
    (signal) => backend.timelines.transcript({ timelineId: timeline.id }, { signal }),
    [backend, timeline.id, timeline.revision],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const stopPreview = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPreview.current?.(), []);
  const chosen = (words.data?.words ?? []).filter((word) => selected.has(wordKey(word)));
  const locked = chosen.some((word) =>
    timeline.tracks.some((track) =>
      track.items.some((item) => item.id === word.clipId && item.type === 'clip' && item.locked),
    ),
  );
  const current = words.data?.revision === timeline.revision;
  const start = Math.min(...chosen.map((word) => word.range.start.value));
  const end = Math.max(...chosen.map((word) => word.range.start.value + word.range.duration.value));
  const preview = () => {
    stopPreview.current?.();
    playhead.seek(start);
    stopPreview.current = playhead.subscribe((frame) => {
      if (frame >= end - 1) {
        playhead.pause();
        stopPreview.current?.();
        stopPreview.current = null;
      }
    });
    playhead.play();
  };
  const wordCount = i18n.number(chosen.length);
  return (
    <section aria-label={t`Words`} className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={mode === 'speech'}
          onClick={() => setMode('speech')}
        >{t`Spoken words`}</Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={mode === 'captions'}
          onClick={() => setMode('captions')}
        >{t`Find and replace captions`}</Button>
      </div>
      {mode === 'captions' ? (
        <CaptionSearch timeline={timeline} edits={edits} playhead={playhead} />
      ) : (
        <>
          <p className="m-0 type-meta text-ink-2">{t`Select words to remove their footage and linked sound. Preview the interval before removing.`}</p>
          {words.error ? <ErrorLine error={words.error} /> : null}
          {!words.data ? (
            <p role="status">{t`Loading spoken words…`}</p>
          ) : !words.data.words.length ? (
            <p className="type-body text-ink-2">{t`No spoken words are available yet. Transcription runs after the footage is imported.`}</p>
          ) : (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t`Transcript words`}>
              {words.data.words.map((word) => {
                const key = wordKey(word);
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={selected.has(key) ? 'secondary' : 'ghost'}
                    aria-pressed={selected.has(key)}
                    title={time.clock(word.range.start.value, timeline.canvas.rate)}
                    onClick={() =>
                      setSelected((before) => {
                        const next = new Set(before);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {word.text}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-meta text-ink-2">{t`${wordCount} words selected`}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!chosen.length || !current}
              onClick={preview}
            >{t`Preview interval`}</Button>
            <Button
              size="sm"
              disabled={!chosen.length || !current || locked || edits.pending}
              title={locked ? t`Unlock the selected scenes before removing words` : undefined}
              onClick={async () => {
                playhead.pause();
                const result = await edits.command(N.removeWords, {
                  revision: words.data?.revision,
                  words: chosen,
                });
                if (result.ok) setSelected(new Set());
              }}
            >{t`Remove from video`}</Button>
            {locked ? <span className="type-meta text-ink-2">{t`A selected scene is locked.`}</span> : null}
          </div>
        </>
      )}
    </section>
  );
}
