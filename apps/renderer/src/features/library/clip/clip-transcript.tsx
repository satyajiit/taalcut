// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: what's said in a clip · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · the transcript as lines, each with where it starts (JetBrains Mono, in its own column);
 *   a line is a control: pressing it moves the playhead there. The line at the playhead sits on the selection wash
 *   with its time in the playhead's marigold; lines said during the shot at the playhead are ink, the rest ink-2,
 *   so the shot and its speech read together. Someone's speech: shown as written
 * states (a line): default · hover (hover surface) · focus (base ring; one tab stop, ↑ ↓ Home End move and seek)
 *   · active (pressed surface) · current (selection wash, aria-current) · disabled n/a · loading (Show more's
 *   spinner) · error (the cause, Try again) · success n/a (the playhead moving is the answer)
 * section states: lines · more (Show more pages the rest) · none (no speech, or no sound: one line, why) · not yet
 *   (still listening: one line) · heard but not written (LIB1-LANG: speech too short or unclear; no language named)
 * contrast: times ink-3 on canvas ≥ 4.5:1, primary-strong on the selection wash ≥ 4.5:1; speech ink and ink-2 ≥ 7:1
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail, AssetId, TaalcutError, TranscriptSegment } from '@taalcut/core';
import { Button, cn, ErrorLine, UserContent, useTimecode, VERB_ICONS } from '@taalcut/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcAction } from '../../../backend/use-rpc';
import { formatLanguage } from '../../shared/format';
import { lineAt, msOf, overlaps, shotAt, type ShotSpan } from './clip-time';
import { useClockValue, type ClipClock } from './player/clip-clock';

type Line = Pick<TranscriptSegment, 'text' | 'range'>;
const MS = { num: 1000, den: 1 } as const;
/** BCP 47 "undetermined": the library's language for speech nobody could place (LIB1-LANG). */
const UNDETERMINED = 'und';

export interface ClipTranscriptProps {
  assetId: AssetId;
  preview: AssetDetail['transcript'];
  /** Why there are no lines: still listening, nobody speaks, or no sound at all. */
  absent: string;
  /** The playhead: the line at it is marked, and lines said during its shot read in ink. */
  clock: ClipClock;
  spans: readonly ShotSpan[];
  onSeek: (at: number) => void;
}

function useMoreLines(assetId: AssetId, preview: AssetDetail['transcript']) {
  const backend = useBackend();
  const [more, setMore] = useState<readonly Line[]>([]);
  const [next, setNext] = useState<number | undefined>(preview?.truncated ? preview.lines.length : undefined);
  const page = useRpcAction((from: number) =>
    backend.library.transcript({ assetId, fromSegment: from, limit: 500 }),
  );
  const [error, setError] = useState<TaalcutError | null>(null);
  const load = async () => {
    if (next === undefined) return;
    const result = await page.run(next);
    if (!result.ok) return setError(result.error);
    setError(null);
    setMore((held) => [...held, ...(result.value?.segments ?? [])]);
    setNext(result.value?.nextSegment);
  };
  return { more, next, load, loading: page.pending, error };
}

export function ClipTranscript({ assetId, preview, absent, clock, spans, onSeek }: ClipTranscriptProps) {
  const { t, i18n } = useLingui();
  const timecode = useTimecode();
  const { more, next, load, loading, error } = useMoreLines(assetId, preview);
  const lines: readonly Line[] = useMemo(() => [...(preview?.lines ?? []), ...more], [preview, more]);
  const current = useClockValue(
    clock,
    useCallback((at: number) => lineAt(lines, at), [lines]),
  );
  const shotIndex = useClockValue(
    clock,
    useCallback((at: number) => shotAt(spans, at)?.index ?? -1, [spans]),
  );
  const shot = spans[shotIndex] ?? null;
  const [focus, setFocus] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // The playhead moved from elsewhere: bring its line into the box's view, without scrolling the page.
  useEffect(() => {
    const scroller = box.current;
    if (current === null || !scroller) return;
    if (moved.current) {
      moved.current = false;
      return;
    }
    const row = scroller.querySelectorAll<HTMLElement>('[data-slot="clip-line"]')[current];
    if (!row) return;
    const top = row.offsetTop - scroller.offsetTop;
    if (top < scroller.scrollTop || top + row.offsetHeight > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
  }, [current]);

  const heading = (
    <h2 id="clip-transcript" className="m-0 flex items-baseline gap-2 text-lg font-semibold text-ink">
      {t`What’s said`}
      {/* LIB1-LANG: a language only over words written in it; `und` is speech nobody could place. */}
      {preview && lines.length > 0 && preview.language !== UNDETERMINED ? (
        <span className="text-sm font-normal text-ink-3">{formatLanguage(i18n, preview.language)}</span>
      ) : null}
    </h2>
  );

  if (!preview || lines.length === 0)
    return (
      <section aria-labelledby="clip-transcript" data-slot="clip-transcript" className="flex flex-col gap-2">
        {heading}
        <p className="m-0 text-sm text-ink-2">{absent}</p>
      </section>
    );

  const seekLine = (index: number) => {
    const line = lines[index];
    if (!line) return;
    moved.current = true;
    setFocus(index);
    onSeek(msOf(line.range.start));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const target =
      event.key === 'ArrowDown'
        ? focus + 1
        : event.key === 'ArrowUp'
          ? focus - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lines.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const index = Math.min(lines.length - 1, Math.max(0, target));
    seekLine(index);
    box.current?.querySelectorAll<HTMLButtonElement>('[data-slot="clip-line"]')[index]?.focus();
  };
  const tabStop = current ?? Math.min(focus, lines.length - 1);

  return (
    <section
      aria-labelledby="clip-transcript"
      data-slot="clip-transcript"
      className="flex min-w-0 flex-col gap-2"
    >
      {heading}
      <div ref={box} className="relative max-h-[26rem] overflow-y-auto">
        <ol
          aria-labelledby="clip-transcript"
          onKeyDown={onKeyDown}
          className="m-0 flex list-none flex-col gap-px p-0"
        >
          {lines.map((line, index) => {
            const from = msOf(line.range.start);
            const span = { from, to: from + msOf(line.range.duration) };
            const isCurrent = index === current;
            return (
              <li key={index}>
                <button
                  type="button"
                  data-slot="clip-line"
                  tabIndex={index === tabStop ? 0 : -1}
                  aria-current={isCurrent || undefined}
                  onClick={() => seekLine(index)}
                  onFocus={() => setFocus(index)}
                  className={cn(
                    'grid w-full cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-md px-2 py-1.5 text-start',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed',
                    isCurrent && 'bg-selected hover:bg-selected',
                  )}
                >
                  <span
                    className={cn(
                      'pt-1 font-mono text-xs tabular-nums',
                      isCurrent ? 'font-medium text-primary-strong' : 'text-ink-3',
                    )}
                  >
                    {timecode.clock(Math.round(from), MS)}
                  </span>
                  <UserContent
                    translate="no"
                    className={cn(
                      'max-w-[65ch] text-md',
                      shot && overlaps(span, shot) ? 'text-ink' : 'text-ink-2',
                    )}
                  >
                    {line.text}
                  </UserContent>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorLine error={error} />
          <Button size="sm" icon={VERB_ICONS.retry} onClick={() => void load()}>
            {t`Try again`}
          </Button>
        </div>
      ) : null}
      {next !== undefined && !error ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          loading={loading}
          onClick={() => void load()}
        >
          {t`Show more`}
        </Button>
      ) : null}
    </section>
  );
}
