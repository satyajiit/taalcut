// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS contract: the editor's full set of edits, the colour grade, sound fades and the music's bed (SPEC). */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  AUDIO_EDIT_COMMANDS,
  defaultMusicBed,
  DRAWN_TRANSITION_KINDS,
  EDITOR_COMMANDS,
  editorCommandPayloads as payloads,
  editorCommandResultSchema,
  FrameRates,
  GRADE_LOOKS,
  gradeSchema,
  isNeutralGrade,
  musicBedSchema,
  NEUTRAL_GRADE,
  newId,
  RationalTime,
  SPEED_KEEPS_PITCH,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  TRANSITION_KINDS,
  type EditItemTarget,
  type EditorContext,
  type Timeline,
  type ToolContextBase,
  type ToolEditorContext,
  type ToolSpec,
} from '../src/index';
import { ntscTimeline } from './helpers/documents';

const ntsc = FrameRates.fps29_97;
const at = (value: number) => ({ value, rate: ntsc });
const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
const clipId = newId<'TimelineItem'>();

/** The fixture's first V1 clip, changed. */
function withFirstClip(change: (clip: Record<string, unknown>) => Record<string, unknown>): Timeline {
  const timeline = ntscTimeline();
  const [video, ...rest] = timeline.tracks;
  if (video?.kind !== 'video') throw new Error('no V1');
  const items = video.items.map((item, index) => (index === 0 ? (change(item) as typeof item) : item));
  return { ...timeline, tracks: [{ ...video, items }, ...rest] };
}

describe('the editor commands', () => {
  it('are named once, beside the first edits', () => {
    const names = [...Object.values(EDITOR_COMMANDS), ...Object.values(AUDIO_EDIT_COMMANDS)];
    expect(names).toEqual([
      'timeline.splitClip',
      'timeline.deleteClip',
      'timeline.insertClip',
      'timeline.duplicateClip',
      'timeline.setSpeed',
      'timeline.setTransition',
      'timeline.removeTransition',
      'timeline.setGrade',
      'timeline.addMarker',
      'timeline.slipClip',
      'audio.setVolume',
      'audio.trim',
      'audio.move',
    ]);
    expect(Object.keys(payloads).sort()).toEqual([...names].sort());
    const old = new Set<string>(Object.values(TIMELINE_COMMANDS));
    expect(names.filter((name) => old.has(name))).toEqual([]);
  });

  it('split and delete take a clip, with the defaults written down', () => {
    expect(payloads[EDITOR_COMMANDS.splitClip].parse({ ...target, clipId, at: at(30) }).snapToBeat).toBe(
      false,
    );
    expect(payloads[EDITOR_COMMANDS.deleteClip].parse({ ...target, clipId }).mode).toBe('ripple');
    expect(payloads[EDITOR_COMMANDS.deleteClip].safeParse({ ...target, clipId, mode: 'cut' }).success).toBe(
      false,
    );
  });

  it('insert names a library shot or a photo and where it goes', () => {
    const insert = payloads[EDITOR_COMMANDS.insertClip];
    const assetId = newId<'Asset'>();
    const video = {
      kind: 'video',
      assetId,
      shotId: newId<'Shot'>(),
      sourceStart: { value: 50, rate: FrameRates.fps25 },
    };
    for (const position of [
      { kind: 'time', at: at(45) },
      { kind: 'before', itemId: clipId },
      { kind: 'after', itemId: clipId },
      { kind: 'slot', slotId: newId<'TemplateSlot'>() },
    ])
      expect(insert.safeParse({ ...target, media: video, position }).success).toBe(true);
    const photo = insert.parse({
      ...target,
      media: { kind: 'image', assetId },
      position: { kind: 'after', itemId: clipId },
    });
    expect(photo.media).toEqual({ kind: 'image', assetId, stillMotion: 'pushIn' });
    expect(insert.safeParse({ ...target, media: video, position: { kind: 'index', index: 2 } }).success).toBe(
      false,
    );
  });

  it('speed is normal, constant or a ramp over shares of the clip, and fits by its media unless asked', () => {
    const speed = payloads[EDITOR_COMMANDS.setSpeed];
    const half = speed.parse({ ...target, clipId, speed: { kind: 'constant', speed: 0.5 } });
    expect([half.fit, half.audio]).toEqual(['media', undefined]);
    const ramp = {
      kind: 'ramp',
      points: [
        { at: 0, speed: 1 },
        { at: 0.5, speed: 3 },
        { at: 1, speed: 1 },
      ],
      curve: 'ease',
    };
    expect(speed.safeParse({ ...target, clipId, speed: ramp, fit: 'length', audio: 'mute' }).success).toBe(
      true,
    );
    const late = {
      ...ramp,
      points: [
        { at: 0.2, speed: 1 },
        { at: 1, speed: 2 },
      ],
    };
    expect(speed.safeParse({ ...target, clipId, speed: late }).success).toBe(false);
    const back = {
      ...ramp,
      points: [
        { at: 0, speed: 1 },
        { at: 0.6, speed: 2 },
        { at: 0.4, speed: 1 },
      ],
    };
    expect(speed.safeParse({ ...target, clipId, speed: back }).success).toBe(false);
    expect(speed.safeParse({ ...target, clipId, speed: { kind: 'constant', speed: 20 } }).success).toBe(
      false,
    );
    expect(SPEED_KEEPS_PITCH).toEqual({ min: 0.5, max: 2 });
  });

  it('transitions are the kinds render draws, on a clip’s edge or by id', () => {
    expect(
      DRAWN_TRANSITION_KINDS.every((kind) => (TRANSITION_KINDS as readonly string[]).includes(kind)),
    ).toBe(true);
    expect(DRAWN_TRANSITION_KINDS).not.toContain('glitch');
    const set = payloads[EDITOR_COMMANDS.setTransition].parse({ ...target, clipId, kind: 'dissolve' });
    expect([set.edge, set.direction, set.duration]).toEqual(['end', null, undefined]);
    expect(
      payloads[EDITOR_COMMANDS.setTransition].safeParse({ ...target, clipId, kind: 'glitch' }).success,
    ).toBe(false);
    const remove = payloads[EDITOR_COMMANDS.removeTransition];
    expect(remove.safeParse({ ...target, transitionId: clipId }).success).toBe(true);
    expect(remove.parse({ ...target, clipId }).edge).toBe('end');
    expect(remove.safeParse(target).success).toBe(false);
    expect(remove.safeParse({ ...target, clipId, transitionId: clipId }).success).toBe(false);
  });

  it('grade changes some fields of clips or the whole video, or takes it off', () => {
    const grade = payloads[EDITOR_COMMANDS.setGrade];
    expect(
      grade.safeParse({
        ...target,
        target: { kind: 'clips', clipIds: [clipId] },
        grade: { temperature: 0.3 },
      }).success,
    ).toBe(true);
    expect(grade.safeParse({ ...target, target: { kind: 'timeline' }, grade: null }).success).toBe(true);
    expect(grade.safeParse({ ...target, target: { kind: 'clips', clipIds: [] }, grade: null }).success).toBe(
      false,
    );
    expect(grade.safeParse({ ...target, target: { kind: 'timeline' }, grade: { exposure: 3 } }).success).toBe(
      false,
    );
    expect(
      grade.safeParse({ ...target, target: { kind: 'timeline' }, grade: { look: 'sepia' } }).success,
    ).toBe(false);
    expect(GRADE_LOOKS).toContain('warm');
    expect(isNeutralGrade(NEUTRAL_GRADE)).toBe(true);
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, look: 'mono', lookStrength: 0 })).toBe(true);
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, contrast: 0.1 })).toBe(false);
  });

  it('a marker defaults to a note at one instant', () => {
    const marker = payloads[EDITOR_COMMANDS.addMarker].parse({ ...target, at: at(12) });
    expect([marker.kind, marker.label, marker.duration, marker.colour]).toEqual([
      'note',
      '',
      undefined,
      undefined,
    ]);
    expect(
      payloads[EDITOR_COMMANDS.addMarker].safeParse({ ...target, at: at(1), duration: at(-2) }).success,
    ).toBe(false);
    expect(
      payloads[EDITOR_COMMANDS.addMarker].safeParse({ ...target, at: at(1), label: 'x'.repeat(121) }).success,
    ).toBe(false);
  });

  it('volume takes clips, the music or a whole group, a level or a change, and something to change', () => {
    const volume = payloads[AUDIO_EDIT_COMMANDS.setVolume];
    expect(volume.safeParse({ ...target, target: { kind: 'music' }, byDb: -6 }).success).toBe(true);
    expect(
      volume.safeParse({ ...target, target: { kind: 'all', group: 'voice' }, muted: true }).success,
    ).toBe(true);
    expect(
      volume.safeParse({ ...target, target: { kind: 'clips', clipIds: [clipId] }, fadeOut: at(15) }).success,
    ).toBe(true);
    expect(volume.safeParse({ ...target, target: { kind: 'music' } }).success).toBe(false);
    expect(volume.safeParse({ ...target, target: { kind: 'music' }, gainDb: -3, byDb: 2 }).success).toBe(
      false,
    );
    expect(volume.safeParse({ ...target, target: { kind: 'music' }, fadeIn: at(-1) }).success).toBe(false);
    expect(
      volume.safeParse({ ...target, target: { kind: 'all', group: 'music' }, muted: true }).success,
    ).toBe(false);
  });

  it('trim and move take one sound clip or the music', () => {
    const trim = payloads[AUDIO_EDIT_COMMANDS.trim];
    expect(trim.safeParse({ ...target, target: { kind: 'music' }, edge: 'start', by: at(-30) }).success).toBe(
      true,
    );
    expect(trim.safeParse({ ...target, target: { kind: 'clip', clipId }, by: at(3) }).success).toBe(false);
    const move = payloads[AUDIO_EDIT_COMMANDS.move];
    expect(move.safeParse({ ...target, target: { kind: 'clip', clipId }, by: at(15) }).success).toBe(true);
    expect(
      move.safeParse({ ...target, target: { kind: 'clips', clipIds: [clipId] }, by: at(15) }).success,
    ).toBe(false);
  });

  it('results name the item an edit made', () => {
    const result = { timelineId: target.timelineId, revision: 4, itemId: clipId };
    expect(editorCommandResultSchema.parse(result)).toEqual(result);
    expect(editorCommandResultSchema.parse({ ...result, itemId: undefined }).itemId).toBeUndefined();
  });
});

describe('the timeline document', () => {
  it('keeps a clip’s grade and sound fades, and checks a fade fits its clip', () => {
    const graded = withFirstClip((clip) => ({
      ...clip,
      grade: { ...NEUTRAL_GRADE, temperature: 0.4, look: 'warm', lookStrength: 0.5 },
      audio: { gainDb: -3, muted: false, fadeIn: at(10), fadeOut: at(20) },
    }));
    const parsed = timelineSchema.parse(graded);
    expect(parsed.tracks[0]?.items[0]).toMatchObject({ grade: { look: 'warm' }, audio: { fadeIn: at(10) } });
    const tooLong = withFirstClip((clip) => ({
      ...clip,
      audio: { gainDb: 0, muted: false, fadeOut: at(61) },
    }));
    expect(timelineSchema.safeParse(tooLong).error?.issues[0]?.path).toEqual([
      'tracks',
      0,
      'items',
      0,
      'audio',
      'fadeOut',
    ]);
    const offRate = withFirstClip((clip) => ({
      ...clip,
      audio: { gainDb: 0, muted: false, fadeIn: { value: 1, rate: FrameRates.fps25 } },
    }));
    expect(timelineSchema.safeParse(offRate).success).toBe(false);
    // A document from before EDT1 loads as it was.
    expect(timelineSchema.parse(ntscTimeline()).grade).toBeUndefined();
  });

  it('keeps the whole video’s grade and the music’s bed', () => {
    const bed = { ...defaultMusicBed(ntsc), start: at(30), end: at(120), fadeOut: at(15) };
    const timeline = {
      ...ntscTimeline(),
      grade: { ...NEUTRAL_GRADE, contrast: 0.2 },
      mix: { ...ntscTimeline().mix, music: bed },
    };
    const parsed = timelineSchema.parse(timeline);
    expect(parsed.grade?.contrast).toBe(0.2);
    expect(parsed.mix.music).toEqual(bed);
    expect(defaultMusicBed(ntsc)).toEqual({
      start: RationalTime.zero(ntsc),
      end: null,
      shift: RationalTime.zero(ntsc),
      fadeIn: RationalTime.zero(ntsc),
      fadeOut: RationalTime.zero(ntsc),
      muted: false,
    });
    expect(musicBedSchema.safeParse({ ...bed, end: at(30) }).success).toBe(false);
    expect(musicBedSchema.safeParse({ ...bed, start: at(-1) }).success).toBe(false);
    expect(gradeSchema.safeParse({ ...NEUTRAL_GRADE, tint: 1.5 }).success).toBe(false);
  });

  it('restore carries the whole video’s grade, null when it had none', () => {
    const restore = timelineCommandPayloads[TIMELINE_COMMANDS.restore];
    expect(restore.parse({ ...target, grade: null }).grade).toBeNull();
    expect(restore.parse({ ...target, grade: NEUTRAL_GRADE }).grade).toEqual(NEUTRAL_GRADE);
    expect(restore.parse(target).grade).toBeUndefined();
  });
});

describe('a docked run’s tools see what the person pointed at', () => {
  it('ToolContextBase.editor carries the editor context and the targets, and is optional', () => {
    expectTypeOf<ToolEditorContext>().toEqualTypeOf<{
      readonly context: EditorContext;
      readonly targets: readonly EditItemTarget[];
    }>();
    expectTypeOf<ToolContextBase['editor']>().toEqualTypeOf<ToolEditorContext | undefined>();
  });

  it('a tool may mend an input before it is checked, and need not', () => {
    expectTypeOf<NonNullable<ToolSpec['mendInput']>>().toEqualTypeOf<(input: unknown) => unknown>();
    const plain: ToolSpec = {
      name: 'demo.plain',
      version: '1.0.0',
      description: 'A tool without a mend.',
      input: z.object({}),
      output: z.object({}),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: { maxAttempts: 1, initialDelayMs: 0 },
      run: async () => ({ ok: true, value: {} }),
    };
    expect(plain.mendInput).toBeUndefined();
  });
});
