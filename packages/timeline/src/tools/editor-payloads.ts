// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: each editor tool's input as its command's payload. Seconds become RationalTime in milliseconds, which
 * every one of these commands lands on the nearest canvas frame (an in-point on the nearest media frame); a speed of
 * 1 is normal; a grade's fields are its patch (`reset` starts from none); a named sound is its target; a slip's
 * part is its `by` or its `avoid` (each named once).
 */
import { NEUTRAL_GRADE, RationalTime, type AudioTarget, type GradePatch } from '@taalcut/core';
import type { EditorInput, EditorToolName } from './editor-json';

/**
 * An input once its clips are ids (editor-tools.ts resolves `clip` and `clips`, clip-refs.ts): the clip as `clipId`,
 * a grade's and a sound's clips as `clipIds`, an insert's place as `itemId`.
 */
export type ResolvedInput<N extends EditorToolName> = Omit<EditorInput<N>, 'clip' | 'clips'> & {
  readonly revision?: number;
  readonly clipId?: string;
  readonly clipIds?: readonly string[];
};
type ResolvedOf =
  | { readonly kind: 'clips'; readonly clipIds: readonly string[] }
  | { readonly kind: 'sound'; readonly sound: 'music' | 'voice' | 'effects' };

const MS = { num: 1000, den: 1 } as const;
/** Seconds as a time core's commands rescale. */
export const ms = (seconds: number) => RationalTime.of(Math.round(seconds * 1000), MS);

const GROUP = { voice: 'voice', effects: 'sfx' } as const;

function speedOf(input: ResolvedInput<'timeline.setSpeed'>) {
  if (input.ramp) return { kind: 'ramp' as const, points: input.ramp.points, curve: input.ramp.curve };
  return input.speed === 1
    ? { kind: 'normal' as const }
    : { kind: 'constant' as const, speed: input.speed as number };
}

function gradeOf(input: ResolvedInput<'timeline.setGrade'>): GradePatch | null {
  const fields = [
    'exposure',
    'highlights',
    'whites',
    'contrast',
    'saturation',
    'temperature',
    'tint',
    'look',
    'lookStrength',
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const field of fields) if (input[field] !== undefined) patch[field] = input[field];
  if (patch.look === 'none') patch.look = null;
  if (!input.reset) return patch as GradePatch;
  return Object.keys(patch).length === 0 ? null : ({ ...NEUTRAL_GRADE, ...patch } as GradePatch);
}

function soundTarget(input: ResolvedInput<'audio.setVolume'>): AudioTarget {
  const of = input.of as ResolvedOf;
  if (of.kind === 'clips') return { kind: 'clips', clipIds: of.clipIds as never };
  return of.sound === 'music' ? { kind: 'music' } : { kind: 'all', group: GROUP[of.sound] };
}

const itemTarget = (input: { readonly clipId?: string | undefined }) =>
  input.clipId ? { kind: 'clip' as const, clipId: input.clipId } : { kind: 'music' as const };

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

/** The command payload for one editor tool's input. */
export function editorPayload<N extends EditorToolName>(
  name: N,
  raw: ResolvedInput<N>,
): Record<string, unknown> {
  const { projectId, timelineId, revision } = raw;
  const base = { projectId, timelineId, ...optional('revision', revision) };
  switch (name) {
    case 'timeline.splitClip': {
      const input = raw as unknown as ResolvedInput<'timeline.splitClip'>;
      return {
        ...base,
        clipId: input.clipId,
        at: ms(input.atSeconds),
        snapToBeat: input.snapToBeat ?? false,
      };
    }
    case 'timeline.deleteClip': {
      const input = raw as unknown as ResolvedInput<'timeline.deleteClip'>;
      return { ...base, clipId: input.clipId, ...optional('mode', input.mode) };
    }
    case 'timeline.insertClip': {
      const input = raw as unknown as ResolvedInput<'timeline.insertClip'>;
      const media =
        input.media.kind === 'video'
          ? {
              kind: 'video',
              assetId: input.media.assetId,
              shotId: input.media.shotId,
              ...optional(
                'sourceStart',
                input.media.inPointSeconds === undefined ? undefined : ms(input.media.inPointSeconds),
              ),
            }
          : {
              kind: 'image',
              assetId: input.media.assetId,
              ...optional('stillMotion', input.media.stillMotion),
            };
      const position =
        input.position.kind === 'time' ? { kind: 'time', at: ms(input.position.atSeconds) } : input.position;
      return {
        ...base,
        media,
        position,
        ...optional('duration', input.durationSeconds === undefined ? undefined : ms(input.durationSeconds)),
      };
    }
    case 'timeline.duplicateClip':
      return { ...base, clipId: (raw as unknown as ResolvedInput<'timeline.duplicateClip'>).clipId };
    case 'timeline.setSpeed': {
      const input = raw as unknown as ResolvedInput<'timeline.setSpeed'>;
      return {
        ...base,
        clipId: input.clipId,
        speed: speedOf(input),
        ...optional('fit', input.fit),
        ...optional('audio', input.audio),
      };
    }
    case 'timeline.setTransition': {
      const input = raw as unknown as ResolvedInput<'timeline.setTransition'>;
      return {
        ...base,
        clipId: input.clipId,
        kind: input.kind,
        direction: input.direction ?? null,
        ...optional('edge', input.edge),
        ...optional('duration', input.durationSeconds === undefined ? undefined : ms(input.durationSeconds)),
      };
    }
    case 'timeline.removeTransition': {
      const input = raw as unknown as ResolvedInput<'timeline.removeTransition'>;
      return {
        ...base,
        ...optional('transitionId', input.transitionId),
        ...optional('clipId', input.clipId),
        ...optional('edge', input.edge),
      };
    }
    case 'timeline.setGrade': {
      const input = raw as unknown as ResolvedInput<'timeline.setGrade'>;
      const target = input.clipIds ? { kind: 'clips', clipIds: input.clipIds } : { kind: 'timeline' };
      return { ...base, target, grade: gradeOf(input) };
    }
    case 'timeline.addMarker': {
      const input = raw as unknown as ResolvedInput<'timeline.addMarker'>;
      return {
        ...base,
        at: ms(input.atSeconds),
        ...optional('duration', input.durationSeconds === undefined ? undefined : ms(input.durationSeconds)),
        ...optional('kind', input.kind),
        ...optional('label', input.label),
        ...optional('colour', input.colour),
      };
    }
    case 'timeline.slipClip': {
      const input = raw as unknown as ResolvedInput<'timeline.slipClip'>;
      const { part } = input;
      return {
        ...base,
        clipId: input.clipId,
        ...('seconds' in part ? { by: ms(part.seconds) } : { avoid: [...new Set(part.avoid)] }),
      };
    }
    case 'audio.setVolume': {
      const input = raw as unknown as ResolvedInput<'audio.setVolume'>;
      return {
        ...base,
        target: soundTarget(input),
        ...optional('gainDb', input.gainDb),
        ...optional('byDb', input.changeDb),
        ...optional('muted', input.muted),
        ...optional('fadeIn', input.fadeInSeconds === undefined ? undefined : ms(input.fadeInSeconds)),
        ...optional('fadeOut', input.fadeOutSeconds === undefined ? undefined : ms(input.fadeOutSeconds)),
      };
    }
    case 'audio.trim': {
      const input = raw as unknown as ResolvedInput<'audio.trim'>;
      return { ...base, target: itemTarget(input), edge: input.edge, by: ms(input.bySeconds) };
    }
    case 'audio.move': {
      const input = raw as unknown as ResolvedInput<'audio.move'>;
      return { ...base, target: itemTarget(input), by: ms(input.bySeconds) };
    }
  }
  return base;
}
