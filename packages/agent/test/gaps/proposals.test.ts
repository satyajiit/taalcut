// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-B8's pure parts: fixes per gap, the defaults by length, hook and cap, answers, and the second method. */
import {
  DEFAULT_MIX,
  FrameRates,
  newId,
  RationalTime,
  type CastNote,
  type Id,
  type SequenceItem,
  type SlotCast,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import {
  answeredRows,
  checkGaps,
  chooseDefaults,
  gapTimelineOf,
  imagePrompt,
  proposeFixes,
  type GapRow,
  type GapSlot,
  type GapsOutput,
  type GapTimeline,
  type GivenGaps,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { PATH } from './gap-harness';

const fps = FrameRates.fps30;
const secs = (s: number) => RationalTime.fromSeconds(s, fps);

function slot(
  number: number,
  state: GapSlot['state'] = 'empty',
  intent: string | null = 'Waves at dawn',
): GapSlot {
  return {
    gapId: newId<'TimelineItem'>(),
    slotId: newId<'TemplateSlot'>(),
    number,
    start: secs((number - 1) * 3),
    duration: secs(3),
    intent: intent === null ? null : { text: intent, shotType: 'close', motion: 'static', energy: 0.4 },
    state,
    note: null,
  };
}

function timeline(slots: GapSlot[], minSeconds: number | null = null, seconds = 15): GapTimeline {
  return {
    timelineId: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    revision: 3,
    duration: secs(seconds),
    minDuration: minSeconds === null ? null : secs(minSeconds),
    slots,
  };
}

const input = { image: PATH, stock: { ok: false as const, reason: 'stockOff' as const } };
const rowsOf = (t: GapTimeline, i = input) =>
  t.slots.map((s) => ({ slot: s, proposal: proposeFixes(s, t, i) }));

describe('fixes per gap', () => {
  it('offers film and drop always, with the length after a drop', () => {
    const t = timeline([slot(2)]);
    const offered = proposeFixes(t.slots[0]!, t, {
      image: { ok: false, reason: 'noImageModel' },
      stock: { ok: true },
    });
    expect(offered.options.map((o) => o.kind)).toEqual(['film', 'stock', 'drop']);
    expect(offered.options.at(-1)).toEqual({ kind: 'drop', newDuration: secs(12) });
    expect(offered.unavailable).toEqual([{ kind: 'generate', reason: 'noImageModel' }]);
  });

  it("writes the still's prompt from the intent, never a real person's likeness", () => {
    expect(imagePrompt(slot(1))).toMatch(/close shot: Waves at dawn\. No real person's face or likeness/);
    expect(imagePrompt(slot(3, 'empty', null))).toContain('a shot for slot 3');
    expect(imagePrompt(slot(1, 'empty', 'x'.repeat(900))).length).toBeLessThanOrEqual(500);
  });
});

describe('the default fix', () => {
  it('drops non-hook gaps while the video stays long enough, then generates', () => {
    const t = timeline([slot(2), slot(3), slot(4)], 9, 15);
    const chosen = chooseDefaults(t, rowsOf(t), { budgetLeftUsd: null });
    expect(t.slots.map((s) => chosen.get(s.gapId)?.fix)).toEqual(['drop', 'drop', 'generate']);
  });

  it('generates the hook within the cap, else drops it with a note; a weak pick no clip beats is kept', () => {
    const t = timeline([slot(1), slot(2, 'weak')]);
    expect(chooseDefaults(t, rowsOf(t), { budgetLeftUsd: 0.05 }).get(t.slots[0]!.gapId)?.fix).toBe(
      'generate',
    );
    const broke = chooseDefaults(t, rowsOf(t), { budgetLeftUsd: 0.01 });
    expect(broke.get(t.slots[0]!.gapId)).toMatchObject({ fix: 'drop', why: expect.stringContaining('hook') });
    expect(broke.get(t.slots[1]!.gapId)?.fix).toBe('keep');
  });

  it('drops past the minimum when nothing else can fill the slot, and says so', () => {
    const t = timeline([slot(2)], 14, 15);
    const none = rowsOf(t, { ...input, image: { ok: false, reason: 'localOnly' } });
    expect(chooseDefaults(t, none, { budgetLeftUsd: null }).get(t.slots[0]!.gapId)?.why).toMatch(/shorter/);
  });
});

describe('answers', () => {
  const row = (fix: GapRow['fix']): GapRow => ({
    timelineId: 't',
    gapId: newId<'TimelineItem'>(),
    slotId: null,
    number: 2,
    state: 'empty',
    intent: '',
    fixes: ['film', 'generate', 'drop'],
    fix,
  });

  it("applies the user's fix where they gave one it offers, keeps the default otherwise", () => {
    const rows = [row('drop'), row('drop'), row('drop')];
    const answered = answeredRows(rows, [
      { gapId: rows[0]!.gapId, fix: 'generate' },
      { gapId: rows[1]!.gapId, fix: 'stock' },
    ]);
    expect(answered.map((r) => r.fix)).toEqual(['generate', 'drop', 'drop']);
    expect(answeredRows(rows, []).map((r) => r.fix)).toEqual(['film', 'film', 'film']);
    expect(answeredRows(rows, undefined)).toEqual(rows);
  });
});

describe('the second method', () => {
  // Slot 4 stays empty: it is on the film list already (BRK1-MAKE: an unsure pick is no gap).
  const t = timeline([{ ...slot(2), state: 'dropped' }, slot(4)]);
  const [dropped, weak] = t.slots;
  const handoff = (patch: Partial<GapsOutput['gaps'][number]> = {}): GapsOutput => ({
    gaps: [
      {
        timelineId: t.timelineId,
        gapId: dropped!.gapId,
        slotId: dropped!.slotId,
        fixes: ['film', 'drop'],
        applied: 'drop',
      },
      {
        timelineId: t.timelineId,
        gapId: weak!.gapId,
        slotId: weak!.slotId,
        fixes: ['film', 'drop'],
        applied: 'film',
        ...patch,
      },
    ],
    filming: 1,
    timelines: [{ timelineId: t.timelineId, revision: 3 }],
  });
  const can = { generate: false, stock: false };

  it('passes a handoff the stored timeline shows', () => {
    expect(checkGaps(handoff(), [t], can)).toEqual({ verdict: 'pass' });
  });

  it.each([
    [{ fixes: ['film' as const] }, /film and drop are always/],
    [{ fixes: ['film' as const, 'generate' as const, 'drop' as const] }, /no still can be generated/],
    [{ fixes: ['film' as const, 'stock' as const, 'drop' as const] }, /stock search isn't available/],
    [{ applied: null }, /nothing was applied/],
    [{ applied: 'stock' as const }, /wasn't one of its fixes/],
    [{ applied: 'drop' as const }, /doesn't show "drop"/],
  ])('refuses %o', (patch, reason) => {
    const verdict = checkGaps(handoff(patch), [t], can);
    expect(verdict.verdict).toBe('retry');
    expect(verdict.verdict === 'retry' && verdict.reason).toMatch(reason);
  });

  it('refuses a stale revision, a gap left out and a wrong film count', () => {
    expect(
      checkGaps({ ...handoff(), timelines: [{ timelineId: t.timelineId, revision: 2 }] }, [t], can),
    ).toMatchObject({
      reason: expect.stringMatching(/revision 3/),
    });
    expect(checkGaps({ ...handoff(), gaps: handoff().gaps.slice(0, 1), filming: 0 }, [t], can)).toMatchObject(
      {
        reason: expect.stringMatching(/Slot 4 .* still a gap/),
      },
    );
    expect(checkGaps({ ...handoff(), filming: 2 }, [t], can)).toMatchObject({
      reason: expect.stringMatching(/1 gap\(s\) went on the film list/),
    });
  });

  describe("with the step's input (round P3-3)", () => {
    // Slot 6 is a gap on the stored timeline the step wasn't given (the user picked slots 2 and 4).
    const wider = { ...t, slots: [...t.slots, slot(6)] };
    const given = (slots: readonly GapSlot[]): GivenGaps =>
      slots.map((s) => ({
        timelineId: t.timelineId,
        gapId: s.gapId,
        slotId: s.slotId,
        number: s.number,
        state: 'empty',
        intent: 'Waves at dawn',
        fixes: ['film', 'drop'],
        fix: 'film',
      }));

    it('checks exactly the gaps it was given, not every gap the timeline still has', () => {
      expect(checkGaps(handoff(), [wider], can)).toMatchObject({ reason: expect.stringMatching(/Slot 6 /) });
      expect(checkGaps(handoff(), [wider], can, given([dropped!, weak!]))).toEqual({ verdict: 'pass' });
    });

    it('refuses a handoff that leaves out a gap it was given', () => {
      const verdict = checkGaps(handoff(), [wider], can, given([dropped!, weak!, wider.slots[2]!]));
      expect(verdict).toMatchObject({
        verdict: 'retry',
        reason: expect.stringMatching(/Slot 6 .* was given/),
      });
    });
  });
});

describe("a stored timeline's gaps", () => {
  const clip = (id: TimelineItemId, slotId: Id<'TemplateSlot'>): Extract<SequenceItem, { type: 'clip' }> => ({
    type: 'clip',
    id,
    media: { kind: 'image', assetId: newId<'Asset'>() },
    sourceStart: secs(0),
    duration: secs(3),
    speed: null,
    slotId,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  });
  const cast = (
    slotId: Id<'TemplateSlot'>,
    clipId: TimelineItemId | null,
    confidence: number | null,
    note: CastNote | null,
  ): SlotCast => ({ slotId, clipId, pick: null, alternates: [], confidence, needsRerank: false, note });

  it('reads empty, weak, filled and dropped slots from the cast and V1; a weak pick by the given rule (FIX-GAPS)', () => {
    const sure = newId<'TimelineItem'>();
    const gap = newId<'TimelineItem'>();
    const weak = newId<'TimelineItem'>();
    const filled = newId<'TimelineItem'>();
    const slot = () => newId<'TemplateSlot'>();
    const [s1, s2, s3, s4, s5] = [slot(), slot(), slot(), slot(), slot()];
    const stored: Timeline = {
      schemaVersion: 2,
      id: newId<'Timeline'>(),
      projectId: newId<'Project'>(),
      name: 'v1',
      revision: 4,
      canvas: { width: 1080, height: 1920, rate: fps },
      template: null,
      beatMap: null,
      tracks: [
        {
          kind: 'video',
          id: 'V1',
          name: 'V1',
          enabled: true,
          items: [
            clip(sure, s1),
            { type: 'gap', id: gap, duration: secs(3), slotId: s2 },
            {
              type: 'transition',
              id: newId<'TimelineItem'>(),
              kind: 'dissolve',
              inOffset: secs(0),
              outOffset: secs(0),
              direction: null,
            },
            clip(weak, s3),
            clip(filled, s4),
          ],
        },
      ],
      markers: [],
      cast: {
        castId: newId<'Cast'>(),
        mode: 'template',
        variantIndex: 0,
        variantCount: 1,
        configVersion: 'test',
        sequenceConfidence: 0.7,
        slots: [
          cast(s1, sure, 0.9, null),
          cast(s2, null, null, 'noCandidates'),
          cast(s3, weak, 0.2, null),
          cast(s4, filled, null, 'gapFilled'),
          cast(s5, null, null, 'dropped'),
        ],
      },
      captions: null,
      music: { path: 'platformSound' },
      styleId: null,
      voiceover: null,
      mix: DEFAULT_MIX,
      createdAt: 1,
      updatedAt: 2,
    };
    const info = {
      pick: { assetId: 'a', shotId: null, description: null, fit: 0.3 },
      confidence: 0.2,
      candidates: [],
      better: null,
    };
    const weakOf = (c: SlotCast) => (c.confidence !== null && c.confidence < 0.5 ? info : null);
    const gaps = gapTimelineOf(stored, { minDuration: secs(6), intentOf: () => null, weakOf });
    expect(gaps.revision).toBe(4);
    expect(gaps.duration).toEqual(secs(12));
    // Slot 3's pick is at 0.2, under the rule's line: a weak pick, with the clip in it now.
    expect(gaps.slots.map((s) => [s.number, s.state, s.gapId])).toEqual([
      [1, 'picked', sure],
      [2, 'empty', gap],
      [3, 'weak', weak],
      [4, 'filled', filled],
      [5, 'dropped', s5],
    ]);
    expect(gaps.slots[2]?.weak).toBe(info);
    expect(gaps.slots[2]?.current).toEqual({ assetId: expect.any(String), shotId: null });
    expect(gaps.slots[3]?.start).toEqual(secs(9));
    // Without the rule no slot is weak: slot 3 is a clip like slot 1.
    const ruleless = gapTimelineOf(stored, { minDuration: secs(6) });
    expect(ruleless.slots.map((s) => s.state)).toEqual(['picked', 'empty', 'picked', 'filled', 'dropped']);
  });
});
