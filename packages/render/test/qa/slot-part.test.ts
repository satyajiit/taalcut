// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: QA's `slotPart` on a made-up reel. Slot 1's clip plays a part of its shot that shows something else while
 * another part of the same shot shows what the slot states (timeline's verdict, from the notes indexing stored): a
 * finding over the slot's frames and a fix that says how far to slip the clip. A slot whose part fits passes; a
 * draft where no part could be read is skipped. Nothing here reads a frame or asks a model. MOM2: a clip that rests
 * on a stretch where the camera is being handled fails too, and its fix says how much of the part does.
 */
import { SLOT_MATCH_CHECK_IDS, type Template, type Timeline } from '@taalcut/core';
import type { PartVerdict, SlotShot } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { slotMatchFact, type SlotMatchBuildInput } from '../../src/qa/checks/slot-match/build';
import { slotPartCheck } from '../../src/qa/checks/slot-match/slot-checks';
import { slotMatchChecks } from '../../src/qa/modules/slot-match';
import { makeTimeline } from '../support/timeline';
import { madeUpReel } from '../workspace/template/reel-fixture';

const RATE = { num: 30, den: 1 };
const MISS: PartVerdict = { met: false, under: 0.31, playsFrom: 4.02, betterFrom: 1.4 };
const MET: PartVerdict = { met: true, under: 0.01, playsFrom: 2, betterFrom: 1.9 };
/** MOM2: all of the part lies in a handling stretch; the clear part that fits starts 2.6 s earlier. */
const HANDLED: PartVerdict = { met: false, under: 0, playsFrom: 4.02, betterFrom: 1.4, handling: 1 };

function world(parts: readonly (PartVerdict | undefined)[]): { input: SlotMatchBuildInput; clips: string[] } {
  const template: Template = madeUpReel().template;
  const base = makeTimeline({ items: [{ frames: 60 }, { frames: 90 }] });
  const v1 = base.tracks[0]!;
  const items =
    v1.kind === 'video'
      ? v1.items.map((item, index) => ({ ...item, slotId: template.slots[index]!.id }))
      : [];
  const clips = items.map((item) => item.id as string);
  const timeline = { ...base, tracks: [{ ...v1, items }] } as unknown as Timeline;
  const shots: SlotShot[] = clips.map((clipId, index) => ({
    clipId,
    slotId: template.slots[index]!.id,
    motion: 'static',
    needs: [],
    ...(parts[index] ? { part: parts[index] } : {}),
  }));
  return {
    clips,
    input: {
      timeline,
      template,
      shots,
      heads: [],
      plan: {
        width: 1080,
        height: 1920,
        rate: RATE,
        visuals: [
          { id: clips[0]!, cut: { start: 0, end: 60 }, enabled: true, slotId: template.slots[0]!.id },
          { id: clips[1]!, cut: { start: 60, end: 150 }, enabled: true, slotId: template.slots[1]!.id },
        ],
        compositions: [],
      },
    },
  };
}

describe('slotPart', () => {
  it('fails a clip on the part that shows something else, and says how far to slip it', () => {
    const { input, clips } = world([MISS, MET]);
    const fact = slotMatchFact(input);
    expect(fact.slots.map((slot) => slot.part)).toEqual([
      { ...MISS, clipId: clips[0] },
      { ...MET, clipId: clips[1] },
    ]);
    const check = slotPartCheck(fact);
    expect(check).toMatchObject({
      id: 'slotPart',
      status: 'warn',
      measured: { value: 1, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
    });
    expect(check.findings).toEqual([
      {
        frames: { start: 0, end: 60 },
        target: { kind: 'clip', id: clips[0] },
        measured: { value: 31, unit: 'percent' },
      },
    ]);
    // The fix is numbers and tool names: no note, which is the user's media and stays in timeline.get's fence.
    expect(check.fixes).toEqual([
      {
        kind: 'agent',
        instructionKey: 'qa.fixes.matchSlotPart',
        params: {
          slot: 1,
          slotId: input.template.slots[0]!.id,
          clipId: clips[0],
          playsShotFrom: 4.02,
          betterPartFrom: 1.4,
          slipSeconds: -2.62,
          tools: 'timeline.get, timeline.slipClip, timeline.swapClip, timeline.findAlternates',
        },
      },
    ]);
  });

  it('fails a clip that rests on a stretch where the camera is being handled, and slips it to a clear part', () => {
    const { input, clips } = world([MET, HANDLED]);
    const check = slotPartCheck(slotMatchFact(input));
    expect(check).toMatchObject({ id: 'slotPart', status: 'warn', measured: { value: 1, unit: 'count' } });
    // Measured by how much of the part lies in the stretch, not by a fit: the slot may state nothing at all.
    expect(check.findings).toEqual([
      {
        frames: { start: 60, end: 150 },
        target: { kind: 'clip', id: clips[1] },
        measured: { value: 100, unit: 'percent' },
      },
    ]);
    expect(check.fixes).toEqual([
      {
        kind: 'agent',
        instructionKey: 'qa.fixes.matchSlotPart',
        params: {
          slot: 2,
          slotId: input.template.slots[1]!.id,
          clipId: clips[1],
          playsShotFrom: 4.02,
          cameraHandlingPercent: 100,
          betterPartFrom: 1.4,
          slipSeconds: -2.62,
          tools: 'timeline.get, timeline.slipClip, timeline.swapClip, timeline.findAlternates',
        },
      },
    ]);
    // A part that fits less well carries no such word.
    const plain = slotPartCheck(slotMatchFact(world([MISS, MET]).input));
    expect(plain.fixes?.[0]).not.toHaveProperty('params.cameraHandlingPercent');
  });

  it('passes when every read part fits, and is skipped when none could be read', () => {
    expect(slotPartCheck(slotMatchFact(world([MET, undefined]).input))).toMatchObject({
      status: 'pass',
      measured: { value: 0, unit: 'count' },
    });
    const unread = slotMatchFact(world([undefined, undefined]).input);
    expect(unread.slots.every((slot) => slot.part === null)).toBe(true);
    expect(slotPartCheck(unread).status).toBe('skipped');
  });

  it('runs with the slot checks, last in core’s order', () => {
    expect(SLOT_MATCH_CHECK_IDS.at(-1)).toBe('slotPart');
    const results = slotMatchChecks(slotMatchFact(world([MISS, MET]).input), null);
    expect(results.map((result) => result.id)).toEqual([...SLOT_MATCH_CHECK_IDS]);
    expect(results.at(-1)).toMatchObject({ id: 'slotPart', status: 'warn' });
  });
});
