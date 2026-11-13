// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { RationalTime, SIMPLE_EDITOR_COMMANDS as N, type Timeline } from '@taalcut/core';
import { Button, useTimecode } from '@taalcut/ui';
import { useState } from 'react';
import type { Edits } from './use-edits';
import type { Playhead } from './playhead';

const fieldClassName = 'min-w-0 rounded-md border border-rule bg-raised px-2 py-1.5 text-ink';
export function CaptionSearch({
  timeline,
  edits,
  playhead,
}: {
  timeline: Timeline;
  edits: Edits;
  playhead: Playhead;
}) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const normalize = (text: string) => (matchCase ? text : text.toLowerCase());
  const matches = find
    ? (timeline.captions?.cues.filter((cue) =>
        normalize(cue.words.map((word) => word.text).join(' ')).includes(normalize(find)),
      ) ?? [])
    : [];
  const matchCount = i18n.number(matches.length);
  const replace = (cueIds?: string[]) =>
    edits.command(N.replaceCaptions, { find, replacement, matchCase, ...(cueIds ? { cueIds } : {}) });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 type-meta text-ink-2">{t`This changes the words shown on screen. The recorded speech stays the same.`}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 type-label">
          {t`Find`}
          <input
            className={fieldClassName}
            value={find}
            maxLength={500}
            onChange={(event) => setFind(event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 type-label">
          {t`Replace with`}
          <input
            className={fieldClassName}
            value={replacement}
            maxLength={500}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </label>
        <Button
          size="sm"
          disabled={!matches.length || edits.pending}
          onClick={() => void replace()}
        >{t`Replace all`}</Button>
      </div>
      <label className="flex items-center gap-2 type-meta">
        <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
        {t`Match case`}
      </label>
      <p role="status" className="m-0 type-meta text-ink-2">
        {timeline.captions ? t`${matchCount} matching captions` : t`This video has no captions yet.`}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {matches.map((cue) => (
          <li key={cue.id} className="flex items-center gap-2 border-t border-rule-subtle pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => playhead.seek(RationalTime.rescale(cue.range.start, timeline.canvas.rate).value)}
            >
              {time.clock(
                RationalTime.rescale(cue.range.start, timeline.canvas.rate).value,
                timeline.canvas.rate,
              )}
            </Button>
            <span className="min-w-0 flex-1 type-body">{cue.words.map((word) => word.text).join(' ')}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={edits.pending}
              onClick={() => void replace([cue.id])}
            >{t`Replace`}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
