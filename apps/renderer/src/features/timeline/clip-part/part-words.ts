// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the Trim tool's sentences. Places in the clip in plain seconds (a clip over a minute reads as a clock),
 * what the scene plays, what the scenes next to it do when an end moves (as `timeline.trimClip` really does it:
 * the neighbour gives or takes the time, the video's last edge makes the video longer or shorter, and its first
 * edge can't be trimmed), and why a change was refused. No editor's jargon: never "slip", "roll" or "ripple".
 */
import { useLingui } from '@lingui/react/macro';
import { errorMessage, useTimecode } from '@taalcut/ui';
import { msAt, type Neighbour, type PartModel } from './part-model';
import type { EdgeStop } from './part-moves';
import type { PartGesture, PartRefusal } from './use-part-gestures';

const MS = { num: 1000, den: 1 } as const;
/** A clip shorter than this reads in seconds; a longer one as a clock. */
const CLOCK_FROM_MS = 60_000;

export interface PartWords {
  /** A place in the clip: "3.2s", or "01:03.20" in a clip over a minute. */
  at(frame: number): string;
  /** "Plays 3.2s to 5.0s of a 12s clip". */
  plays(from: number, to: number): string;
  /** A slider's name and value. */
  slider(gesture: PartGesture, from: number, to: number): { label: string; value: string };
  /** What dragging does, said at rest: the part, then the ends (the truth about the neighbours). */
  rest(): string[];
  /**
   * While an end moves by `trim` canvas frames: how long the scene would last, who makes room, and (`stop`) why
   * the end goes no further.
   */
  resizing(gesture: 'start' | 'end', trim: number, stop: EdgeStop | null): string[];
  refused(refusal: PartRefusal): string;
  /** After a change went through, for a screen reader. */
  landed(from: number, to: number): string;
}

export function usePartWords(part: PartModel, sceneNumber: number, onBeat: boolean): PartWords {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const n = i18n.number(sceneNumber);
  const fileMs = msAt(part, part.fileTo);
  const total = time.length(Math.round(fileMs), MS);

  const at = (frame: number) => {
    const ms = Math.max(0, msAt(part, frame));
    if (fileMs >= CLOCK_FROM_MS) return time.clock(Math.round(ms), MS, { fraction: true });
    return i18n.number(Math.round(ms / 100) / 10, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  };
  const frames = (canvasFrames: number) => time.length(Math.abs(canvasFrames), part.canvasRate);
  const sceneOf = (neighbour: Neighbour | null) =>
    neighbour?.kind === 'scene' && neighbour.number !== null ? i18n.number(neighbour.number) : null;

  return {
    at,
    plays(from, to) {
      const [fromText, toText] = [at(from), at(to)];
      return t`Plays ${fromText} to ${toText} of a ${total} clip`;
    },
    slider(gesture, from, to) {
      const [fromText, toText] = [at(from), at(to)];
      if (gesture === 'start')
        return { label: t`Where scene ${n} begins`, value: t`Begins ${fromText} into the clip` };
      if (gesture === 'end')
        return { label: t`Where scene ${n} ends`, value: t`Ends ${toText} into the clip` };
      return { label: t`The part scene ${n} plays`, value: t`${fromText} to ${toText} of ${total}` };
    },
    rest() {
      const [p, q] = [sceneOf(part.before), sceneOf(part.after)];
      const first = t`The video starts with this scene, so only its end can be dragged.`;
      const ends = !part.before
        ? !part.after
          ? [t`Drag its end to make the video longer or shorter.`, first]
          : [
              q
                ? t`Drag its end to make the scene longer or shorter: scene ${q} makes room, and nothing else moves.`
                : t`Drag its end to make the scene longer or shorter: what comes after it makes room, and nothing else moves.`,
              first,
            ]
        : !part.after
          ? [
              p
                ? t`Drag its beginning and scene ${p} makes room. Drag its end and the video gets longer or shorter.`
                : t`Drag its beginning and what comes before it makes room. Drag its end and the video gets longer or shorter.`,
            ]
          : [
              p && q
                ? t`Drag an end to make the scene longer or shorter: scene ${p} or scene ${q} makes room, and nothing else moves.`
                : t`Drag an end to make the scene longer or shorter: what is next to it makes room, and nothing else moves.`,
            ];
      return [
        t`Drag the part, or click where the scene should start. The scene keeps its place and length.`,
        ...ends,
      ];
    },
    resizing(gesture, trim, stop) {
      const length = frames(part.cutOut - part.cutIn + trim);
      const neighbour = gesture === 'start' ? part.before : part.after;
      const m = sceneOf(neighbour);
      const lines = [t`The scene would last ${length}.`];
      if (trim !== 0) {
        const amount = frames(trim);
        // The scene grows, so what is next to it shrinks, and the other way round.
        const grows = trim > 0;
        if (!neighbour)
          lines.push(grows ? t`The video gets ${amount} longer.` : t`The video gets ${amount} shorter.`);
        else if (m)
          lines.push(
            grows
              ? t`Scene ${m} gets ${amount} shorter. Nothing else moves.`
              : t`Scene ${m} gets ${amount} longer. Nothing else moves.`,
          );
        else
          lines.push(
            grows
              ? t`What is next to it gets ${amount} shorter. Nothing else moves.`
              : t`What is next to it gets ${amount} longer. Nothing else moves.`,
          );
      }
      if (stop === 'footage') lines.push(t`There isn’t enough of the clip left to go further.`);
      if (stop === 'shortest') lines.push(t`The scene is too short to lose more.`);
      if (stop === 'neighbour')
        lines.push(
          m
            ? t`Scene ${m} is too short to give up more.`
            : t`What is next to it is too short to give up more.`,
        );
      if (stop === 'neighbourFootage')
        lines.push(
          m
            ? t`Scene ${m} has too little of its clip left to fill more room.`
            : t`What is next to it can’t fill more room.`,
        );
      if (onBeat) lines.push(t`The video follows a beat, so the end lands on the nearest beat.`);
      return lines;
    },
    refused({ gesture, error }) {
      const short = error.code === 'timeline.media_too_short';
      const invalid = error.code === 'timeline.invalid_move';
      if (gesture === 'move') {
        if (short)
          return t`The clip ends before the scene would. Pick an earlier part, or make the scene shorter first.`;
        if (invalid)
          return t`That part doesn’t fit inside one shot of the clip. Pick a part inside it, or make the scene shorter first.`;
      } else {
        if (short)
          return t`There isn’t enough footage for that: this clip, or the one next to it, runs out. Move the end by less.`;
        if (invalid)
          return t`What is next to the scene is too short to make that much room. Move the end by less.`;
      }
      return errorMessage(i18n, error);
    },
    landed(from, to) {
      const [fromText, toText] = [at(from), at(to)];
      return t`Scene ${n} now plays ${fromText} to ${toText}.`;
    },
  };
}
