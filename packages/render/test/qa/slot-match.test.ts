// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: a draft against its template, slot by slot, on a made-up reel (two slots and two chat bubbles). Slot 1
 * needs "someone looking at a phone" with the face kept out, held still; the draft's walking shot meets neither, its
 * face shows, its person sits off to the side and its camera tracks. Each failure is a finding over the slot's frames
 * and a fix naming the slot, what differs and the tools; the reel's bubbles are held to the reel's place.
 */
import { newId, type QaCheckResult, type Rect, type Template, type Timeline } from '@taalcut/core';
import type { SlotShot } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import type { ClipHeads } from '../../src/engine/stages/heads';
import { slotMatchFact, type SlotMatchBuildInput } from '../../src/qa/checks/slot-match/build';
import {
  slotFaceCheck,
  slotFramingCheck,
  slotMotionCheck,
  slotNeedsCheck,
  slotTimingCheck,
} from '../../src/qa/checks/slot-match/slot-checks';
import { slotGraphicsCheck } from '../../src/qa/checks/slot-match/slot-graphics';
import { QA_MODULES } from '../../src/qa/modules';
import { checkMeta } from '../../src/qa/result';
import { expectedPlace } from '../../src/workspace/designer/reel-match';
import { DESIGN_CANVAS } from '../../src/workspace/template/brief';
import { makeTimeline } from '../support/timeline';
import { madeUpReel, QUESTION_WORDS } from '../workspace/template/reel-fixture';
import { qaPlan, runInput } from './support';

const RATE = { num: 30, den: 1 };
const NEED = 'someone looking at a phone';

function reel(): Template {
  const { template } = madeUpReel();
  const slots = template.slots.map((slot, index) =>
    index === 0
      ? {
          ...slot,
          intent: { ...slot.intent, needs: [NEED], face: 'hidden' as const, motion: 'static' as const },
        }
      : slot,
  );
  // The reel's person: a head left of middle in slot 1 (0 to 2 s).
  const head = { box: { x: 0.3, y: 0.2, width: 0.2, height: 0.12 }, confidence: 0.9 };
  const subjects = {
    version: 1 as const,
    detector: 'vision' as const,
    hz: 2,
    samples: [0, 15, 30, 45].map((frame) => ({ t: { value: frame, rate: RATE }, heads: [head], people: [] })),
  };
  return { ...template, slots, subjects };
}

interface World {
  readonly input: SlotMatchBuildInput;
  readonly clips: readonly string[];
  readonly graphic: string;
}

function world(
  change: { faces?: number; headX?: number; slot2Frames?: number; noGraphic?: boolean } = {},
): World {
  const template = reel();
  const [first, second] = template.slots;
  const slot2Frames = change.slot2Frames ?? 90;
  const base = makeTimeline({ items: [{ frames: 60 }, { frames: slot2Frames }] });
  const v1 = base.tracks[0]!;
  const items =
    v1.kind === 'video'
      ? v1.items.map((item, index) => ({ ...item, slotId: template.slots[index]!.id }))
      : [];
  const clips = items.map((item) => item.id as string);
  const graphic = newId<'TimelineItem'>() as string;
  const question = template.text.find((overlay) => overlay.text === QUESTION_WORDS)!;
  const text = {
    kind: 'text',
    id: newId<'Track'>(),
    items: change.noGraphic
      ? []
      : [{ type: 'graphic', id: graphic, overlay: { id: question.id, words: 'template' } }],
  };
  const timeline = { ...base, tracks: [{ ...v1, items }, text] } as unknown as Timeline;
  const faces = change.faces ?? 2;
  const headX = change.headX ?? 0.7;
  const heads: ClipHeads[] = [
    {
      id: clips[0]!,
      cut: { start: 0, end: 60 },
      visible: { start: 0, end: 60 },
      samples: [0, 15, 30, 45].map((frame, index) => ({
        frame,
        next: frame + 15,
        heads: [{ x: headX * 1080, y: 0.2 * 1920, width: 0.2 * 1080, height: 0.12 * 1920 }],
        face: index < faces,
      })),
    },
  ];
  const shots: SlotShot[] = [
    {
      clipId: clips[0]!,
      slotId: first!.id,
      motion: 'tracking',
      needs: [{ text: NEED, met: false, by: null, others: 2 }],
    },
    { clipId: clips[1]!, slotId: second!.id, motion: 'static', needs: [] },
  ];
  return {
    clips,
    graphic,
    input: {
      timeline,
      template,
      shots,
      heads,
      plan: {
        width: 1080,
        height: 1920,
        rate: RATE,
        visuals: [
          { id: clips[0]!, cut: { start: 0, end: 60 }, enabled: true, slotId: first!.id },
          { id: clips[1]!, cut: { start: 60, end: 60 + slot2Frames }, enabled: true, slotId: second!.id },
        ],
        compositions: change.noGraphic
          ? []
          : [{ itemId: graphic, span: { start: 30, end: 120 }, values: { text: QUESTION_WORDS } }],
      },
    },
  };
}

const fixOf = (check: QaCheckResult, index = 0) => {
  const fix = check.fixes[index];
  return fix?.kind === 'agent' ? fix : undefined;
};

describe('slot match', () => {
  it('is a set of slot checks the person may override, and runs as a module', () => {
    for (const id of [
      'slotNeeds',
      'slotFace',
      'slotFraming',
      'slotMotion',
      'slotTiming',
      'slotGraphics',
    ] as const) {
      expect(checkMeta(id)).toMatchObject({ group: 'slots', overridable: true, preflight: false });
      expect(QA_MODULES.some((module) => module.ids.includes(id))).toBe(true);
    }
  });

  it('fails a slot whose shot misses its need, naming the need, the candidates and the tools', () => {
    const { input, clips } = world();
    const fact = slotMatchFact(input);
    const check = slotNeedsCheck(fact);
    expect(check).toMatchObject({ status: 'warn', measured: { value: 1, unit: 'count' } });
    expect(check.findings).toEqual([
      {
        frames: { start: 0, end: 60 },
        target: { kind: 'clip', id: clips[0] },
        measured: { value: 1, unit: 'count' },
      },
    ]);
    expect(fixOf(check)).toEqual({
      kind: 'agent',
      instructionKey: 'qa.fixes.matchSlotNeeds',
      params: {
        slot: 1,
        slotId: input.template.slots[0]!.id,
        clipId: clips[0],
        need: NEED,
        unmet: 1,
        needs: 1,
        others: 2,
        tools: 'timeline.findAlternates, timeline.swapClip, library.search, timeline.slipClip',
      },
    });
  });

  it('fails a face the reel hides when it shows, and passes once it is kept out', () => {
    const shown = slotFaceCheck(slotMatchFact(world().input));
    expect(shown.status).toBe('warn');
    expect(fixOf(shown)?.params).toMatchObject({ slot: 1, wanted: 'hidden', facePct: 50 });
    expect(slotFaceCheck(slotMatchFact(world({ faces: 0 }).input)).status).toBe('pass');
  });

  it("fails a person framed away from the reel's, with both places, and passes one where the reel has them", () => {
    const off = slotFramingCheck(slotMatchFact(world().input));
    expect(off.status).toBe('warn');
    expect(fixOf(off)?.params).toMatchObject({ slot: 1, reelX: 40, draftX: 80, reelSize: 12, draftSize: 12 });
    expect(slotFramingCheck(slotMatchFact(world({ headX: 0.32 }).input)).status).toBe('pass');
  });

  it('fails a tracking shot where the reel holds still, and leaves a slot without a stated move out', () => {
    const check = slotMotionCheck(slotMatchFact(world().input));
    expect(check.status).toBe('warn');
    expect(check.findings).toHaveLength(1);
    expect(fixOf(check)?.params).toMatchObject({ slot: 1, reel: 'static', shot: 'tracking' });
  });

  it("holds each slot to the reel's length", () => {
    expect(slotTimingCheck(slotMatchFact(world().input)).status).toBe('pass');
    const short = slotTimingCheck(slotMatchFact(world({ slot2Frames: 45 }).input));
    expect(short.status).toBe('warn');
    expect(fixOf(short)?.params).toMatchObject({ slot: 2, reelMs: 3000, draftMs: 1500 });
    expect(short.findings[0]?.measured).toEqual({ value: -1.5, unit: 'seconds' });
  });

  it("holds the reel's bubbles to the reel's place, and fails one the draft doesn't draw", () => {
    const { input, graphic } = world();
    const fact = slotMatchFact(input);
    const question = fact.graphics.find((entry) => entry.itemId === graphic)!;
    const place = expectedPlace(question.brief);
    const scale = 1080 / DESIGN_CANVAS.width;
    const atReel: Rect = {
      x: place.left * scale,
      y: place.top * scale,
      width: place.width * scale,
      height: place.height * scale,
    };
    const placed = slotGraphicsCheck(fact, (id) => (id === graphic ? atReel : null));
    // The reply bubble has no graphic: it fails as missing, in slot 2; the question passes.
    expect(placed.status).toBe('warn');
    expect(placed.fixes).toHaveLength(1);
    expect(fixOf(placed)?.params).toMatchObject({ slot: 2, missing: 1 });
    const moved = slotGraphicsCheck(fact, (id) => (id === graphic ? { ...atReel, x: atReel.x + 300 } : null));
    expect(moved.fixes.map((fix) => (fix.kind === 'agent' ? fix.params.slot : 0))).toEqual([1, 2]);
    expect(fixOf(moved)?.params).toMatchObject({ itemId: graphic, side: 'left', acrossPct: 28 });
  });

  it('skips every slot check for a render without a template', async () => {
    const module = QA_MODULES.find((candidate) => candidate.ids.includes('slotNeeds'))!;
    const results = await module.run(
      { run: runInput('/no/file.mp4', qaPlan()), facts: {}, probed: null },
      new Set(module.ids),
    );
    expect(results.map((result) => result.status)).toEqual(Array(6).fill('skipped'));
  });
});
