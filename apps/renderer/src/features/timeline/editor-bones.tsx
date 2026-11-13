// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: editor bones · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the editor's shape while the project and its cut load (PRD R32, UX1), part for part where the editor draws
 *   them: the viewer's 9:16 frame on its grey with the viewer's own loading pulse (as PreviewFrame shows it); the
 *   inspector (title, facts, the AI and you legend, its sentence); the transport (play, timecode, beat, zoom); and
 *   the bed on its sunken ground: the track gutter, the ruler and its ticks, the clips cut on the beat with their
 *   label strips, the rose beat ticks, the words track and the pacing row. Hand-drawn, not captured: the viewer
 *   grey and the bed's ground are part of the shape, and captured bones are one colour
 * states: loading only · pre-emit critique: P5 H5 E5 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';

/** Clip widths in beats, so the bones read as a cut on the beat. */
const CLIPS = [4, 2, 3, 3, 4, 2, 2, 4, 3, 3, 2, 4] as const;
/** Words on screen: where each starts and how long it stays, in clips. */
const WORDS = [
  [0, 2],
  [4, 2],
  [7, 2],
  [11, 1],
] as const;
const BONE = 'tc-bone block rounded-sm bg-hover';

function InspectorBones() {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-4 border-l border-rule-subtle p-4">
      <div className="flex flex-col gap-2">
        <span className={cn(BONE, 'h-4 w-24')} />
        <span className={cn(BONE, 'h-3 w-36')} />
      </div>
      <div className="flex flex-col gap-2">
        {[40, 32].map((width) => (
          <span key={width} className="flex items-center gap-2">
            <span className={cn(BONE, 'h-0.5 w-4')} />
            <span className={cn(BONE, 'h-3')} style={{ width: `${width * 4}px` }} />
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className={cn(BONE, 'h-3 w-full')} />
        <span className={cn(BONE, 'h-3 w-11/12')} />
        <span className={cn(BONE, 'h-3 w-2/3')} />
      </div>
    </div>
  );
}

function TransportBones() {
  return (
    <div className="flex h-11 items-center gap-3 px-3">
      <span className={cn(BONE, 'size-8 rounded-md')} />
      <span className={cn(BONE, 'h-3.5 w-28')} />
      <span className={cn(BONE, 'h-3 w-20')} />
      {/* The edit tools: Undo, Redo, a beat shorter and longer (UX4). */}
      <span className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((tool) => (
          <span key={tool} className={cn(BONE, 'size-6 rounded-md')} />
        ))}
      </span>
      <span className="ms-auto flex items-center gap-2">
        <span className={cn(BONE, 'h-3 w-12')} />
        <span className={cn(BONE, 'size-6 rounded-md')} />
        <span className={cn(BONE, 'size-6 rounded-md')} />
      </span>
    </div>
  );
}

function BedBones() {
  const total = CLIPS.reduce((sum, beats) => sum + beats, 0);
  const starts = CLIPS.map((_, index) => CLIPS.slice(0, index).reduce((sum, beats) => sum + beats, 0));
  return (
    <div className="flex bg-sunken">
      {/* The track gutter: the ruler's corner, then one cell per track. */}
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-rule-subtle">
        <div className="h-7 w-full border-b border-rule-subtle" />
        <div className="flex h-16 items-center">
          <span className={cn(BONE, 'size-3.5')} />
        </div>
        <div className="h-3" />
        <div className="flex h-7 items-center">
          <span className={cn(BONE, 'size-3.5')} />
        </div>
      </div>
      <div className="relative min-w-0 flex-1 pe-4 pb-2">
        {/* The ruler: a tick on every beat, a taller one on every bar. */}
        <div className="relative h-7 border-b border-rule-subtle">
          {Array.from({ length: total + 1 }, (_, beat) => (
            <span
              key={beat}
              className={cn('absolute bottom-0 w-px bg-rule', beat % 4 === 0 ? 'h-3' : 'h-1.5')}
              style={{ left: `${(beat / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex h-16 gap-px pt-1">
          {CLIPS.map((beats, index) => (
            <div
              key={index}
              className="flex min-w-0 flex-col gap-px"
              style={{ flexGrow: beats, flexBasis: 0 }}
            >
              <span className={cn(BONE, 'h-3.5 rounded-clip')} />
              <span className={cn(BONE, 'flex-1 rounded-clip')} />
            </div>
          ))}
        </div>
        <div className="relative h-3">
          {starts.map((start) => (
            <span
              key={start}
              className="absolute top-0.5 h-2 w-px bg-beat-strong opacity-40"
              style={{ left: `${(start / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="relative h-7">
          {WORDS.map(([clip, span]) => {
            const from = starts[clip] ?? 0;
            const to = starts[clip + span] ?? total;
            return (
              <span
                key={clip}
                className={cn(BONE, 'absolute top-1 h-5 rounded-clip')}
                style={{ left: `${(from / total) * 100}%`, width: `${((to - from) / total) * 90}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EditorBones() {
  const { t } = useLingui();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t`Loading the timeline`}
      data-slot="editor-bones"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 items-center justify-center bg-viewer p-4">
          {/* The stage is the viewer's grey, as in the editor (UX4); the viewer's grey with the words on screen as bones on it, pulsing as PreviewFrame's loading
              does, so the frame never reads as a black hole. */}
          <div className="tc-viewer relative flex aspect-[9/16] h-full max-h-full flex-col items-center overflow-hidden rounded-xl">
            <span className="tc-bone absolute inset-0 block bg-viewer-rule opacity-30" />
            <span className="tc-bone relative mt-[28%] block h-3.5 w-3/5 rounded-sm bg-viewer-rule" />
            <span className="tc-bone relative mt-2 block h-3.5 w-2/5 rounded-sm bg-viewer-rule" />
          </div>
        </div>
        <InspectorBones />
      </div>
      <div className="shrink-0 border-t border-rule-subtle">
        <TransportBones />
        <BedBones />
        <div className="flex h-11 items-center gap-2 border-t border-rule-subtle bg-sunken px-4">
          <span className={cn(BONE, 'size-4')} />
          <span className={cn(BONE, 'h-3 w-16')} />
        </div>
      </div>
    </div>
  );
}
