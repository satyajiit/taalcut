// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: editor showcase, a cut in the editor · mode: Operate · system: WEB2 Remix Vernacular (Timeline; the
 *   One Marigold Rule: the playhead is the only marigold here, a line, never a fill)
 * the editor lean, in the coded app window open on Make: a bar with the cut's name, Play and the timecode; the
 *   preview at the playhead (the owner's footage under the title and captions) beside the title the AI designed and its
 *   two values; the timeline (clips, captions word by word, music beats, the playhead); the chosen clip's line with
 *   its trims; a legend that puts a word beside every colour; the export formats as facts
 * states: Play (default, hover, focus, active) and Pause while it plays; a clip the AI's pick (violet), still the
 *   AI's after a trim, which moves its edge and adds the neutral "Trimmed" note (teal marks a swap, a move or a
 *   slip, never a trim); trim buttons disabled where a clip can't give up or take a beat; Undo trims (shows once
 *   you trimmed) · loading/error n/a (the cut is made in the page)
 * motion: the playhead while it plays (asked for, with Pause); the title's values (graphic-values.tsx) */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { ShowcasePlate } from '../plate';
import { frameAtTime } from '../frames';
import { formatTime } from '../timecode';
import {
  canTrim,
  captionAt,
  clipAt,
  clipBeats,
  clipSpan,
  CLIPS,
  sampleCut,
  TITLE,
  trimClip,
  type Cut,
  type Place,
} from './cut';
import { EditorTimeline } from './editor-timeline';
import { GraphicValues, TitlePreview } from './graphic-values';

/** The cut and its trims, shared with the features index. */
export function useCutEdits() {
  const base = useMemo(sampleCut, []);
  const [cut, setCut] = useState<Cut>(base);
  const [trimmed, setTrimmed] = useState<ReadonlySet<number>>(new Set());
  const [selected, setSelected] = useState(2);
  const trim = (index: number, by: number) => {
    const next = trimClip(cut, index, by);
    if (next === cut) return;
    setCut(next);
    setTrimmed((now) => new Set(now).add(index));
  };
  const undo = () => {
    setCut(base);
    setTrimmed(new Set());
  };
  return { cut, trimmed, selected, setSelected, trim, undo };
}

function usePlayback(duration: number, start: number) {
  const [at, setAt] = useState(start);
  const [playing, setPlaying] = useState(false);
  const from = useRef({ wall: 0, at: start });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const next = from.current.at + (now - from.current.wall) / 1000;
      if (next >= duration) {
        setAt(duration);
        setPlaying(false);
        return;
      }
      setAt(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const begin = at >= duration - 0.05 ? 0 : at;
    from.current = { wall: performance.now(), at: begin };
    setAt(begin);
    setPlaying(true);
  };
  return { at, playing, toggle };
}

function ClipLine({ edits }: { readonly edits: ReturnType<typeof useCutEdits> }) {
  const { cut, trimmed, selected, trim, undo } = edits;
  const clip = CLIPS[selected];
  if (!clip) return null;
  const [start, end] = clipSpan(cut, selected);
  const cutDown = trimmed.has(selected);
  const Trim = SHOWCASE_ICONS.trim;
  const Undo = SHOWCASE_ICONS.undo;
  const beats = clipBeats(cut, selected);
  return (
    <div className="flex flex-col gap-3 @min-[52rem]:flex-row @min-[52rem]:items-start @min-[52rem]:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink">
          <span className="font-medium">Clip {selected + 1}</span>
          <span>{clip.word}</span>
          <span className="tc-mono type-meta text-ink-2">
            {formatTime(start)} to {formatTime(end)}
          </span>
          <span className="type-meta text-ink-2">
            {beats} {beats === 1 ? 'beat' : 'beats'}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2" role="status">
          <Chip tone="ai">
            <AiMark />
            AI pick
          </Chip>
          {cutDown ? (
            <>
              <Chip>
                <Trim aria-hidden />
                Trimmed
              </Chip>
              <span className="type-body text-ink-2">
                Its end moved on the beat, and the next clip starts there.
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-keyshortcuts="["
          className={buttonClasses('secondary', 'md')}
          disabled={!canTrim(cut, selected, -1)}
          onClick={() => trim(selected, -1)}
        >
          <Trim aria-hidden className="size-4" />A beat shorter
        </button>
        <button
          type="button"
          aria-keyshortcuts="]"
          className={buttonClasses('secondary', 'md')}
          disabled={!canTrim(cut, selected, 1)}
          onClick={() => trim(selected, 1)}
        >
          A beat longer
        </button>
        {trimmed.size > 0 ? (
          <button type="button" className={buttonClasses('quiet', 'md')} onClick={undo}>
            <Undo aria-hidden className="size-4" />
            Undo trims
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul
      aria-label="What the colours mean"
      className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 type-meta text-ink-2"
    >
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-[3px] w-4 rounded-pill bg-ai-strong" />
        AI pick
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px rounded-pill bg-beat-strong" />
        Music beat
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-0.5 rounded-pill bg-playhead-strong" />
        Playhead
      </li>
    </ul>
  );
}

function ExportFacts() {
  const Export = SHOWCASE_ICONS.export;
  const facts = [
    [SHOWCASE_ICONS.clip, 'Video', 'MP4, H.264 or HEVC, for Reels, Shorts and TikTok'],
    [SHOWCASE_ICONS.values, 'For other editors', 'OTIO and FCPXML'],
    [SHOWCASE_ICONS.caption, 'Captions', 'An SRT file'],
  ] as const;
  return (
    <section aria-label="Export formats" className="flex flex-col gap-3 rounded-xl bg-panel p-3">
      <p className="m-0 flex items-center gap-2 type-label text-ink">
        <Export aria-hidden className="size-4 text-ink-3" />
        Exports as
      </p>
      <dl className="m-0 flex flex-col gap-2.5">
        {facts.map(([Icon, label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="flex items-center gap-2 type-meta text-ink-2">
              <Icon aria-hidden className="size-4 shrink-0 text-ink-3" />
              {label}
            </dt>
            <dd className="m-0 ps-6 type-body text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function EditorShowcase() {
  const edits = useCutEdits();
  const { at, playing, toggle } = usePlayback(edits.cut.duration, 3.2);
  const [size, setSize] = useState(TITLE.size);
  const [place, setPlace] = useState<Place>(TITLE.place);
  const current = clipAt(edits.cut, at);
  const sprite = frameAtTime(CLIPS[current]?.clipId, at - clipSpan(edits.cut, current)[0]);
  const Toggle = playing ? SHOWCASE_ICONS.pause : SHOWCASE_ICONS.play;

  return (
    <AppWindow title="Editor" area="make" size="lg" fit="fluid">
      <ShowcasePlate slug="editor" label="A cut in the editor" className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center gap-3 border-b border-rule-subtle pb-4">
          <h3 className="m-0 me-auto type-page-title text-ink">Vietnam reel, your cut</h3>
          <span className="tc-mono type-meta text-ink-2">
            {formatTime(at)} / {formatTime(edits.cut.duration)}
          </span>
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={toggle}>
            <Toggle aria-hidden className="size-4" />
            {playing ? 'Pause' : 'Play'}
          </button>
        </header>
        <div className="grid grid-cols-1 gap-6 @min-[34rem]:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] @min-[60rem]:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)]">
          <div className="w-44 @min-[34rem]:w-full">
            <TitlePreview size={size} place={place} sprite={sprite} caption={captionAt(at)} />
          </div>
          <GraphicValues
            size={size}
            place={place}
            onSize={setSize}
            onPlace={setPlace}
            onReset={() => {
              setSize(TITLE.size);
              setPlace(TITLE.place);
            }}
          />
          <div className="@min-[34rem]:col-span-2 @min-[60rem]:col-span-1">
            <ExportFacts />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <EditorTimeline
            cut={edits.cut}
            trimmed={edits.trimmed}
            selected={edits.selected}
            onSelect={edits.setSelected}
            onTrim={edits.trim}
            at={at}
          />
          <ClipLine edits={edits} />
          <Legend />
        </div>
      </ShowcasePlate>
    </AppWindow>
  );
}
