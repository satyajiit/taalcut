// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: timeline.get's rows say what each clip's slot is for, and the cast's score for the clip there. */
import { newId, RationalTime, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { SLOT_INTENT_CHARS, slotFactsOf, slotPlacesOf } from '../../src/tools/slot-facts';
import { agentWorld } from '../fixtures/agent';
import { agentToolContext } from '../fixtures/tool-context';
import { buildTemplate } from '../fixtures/template';

interface Row {
  clipId: string;
  slotId?: string | null;
  slot?: {
    slot: number;
    intent: string;
    needs: string[];
    face: string | null;
    reel: { at: number; seconds: number };
    cast?: { score: number; parts: Record<string, number | null> };
  };
}

describe('timeline.get rows carry their slot', () => {
  it('with the template’s intent, the reel’s timing and the cast’s score, in and out of the editor', async () => {
    const { call, template, projectId } = agentWorld();
    const assembled = await call('timeline.assemble', {
      projectId,
      template: { id: template.id },
      variants: 1,
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const read = await call('timeline.get', { timelineId });
    if (!read.ok) throw new Error(read.error.code);
    const rows = read.value.clips as Row[];
    expect(rows.length).toBe(template.slots.length);
    rows.forEach((row, index) => {
      const slot = template.slots[index]!;
      expect(row.slotId).toBe(slot.id);
      expect(row.slot).toMatchObject({
        slot: index + 1,
        intent: slot.intent.text,
        needs: [],
        face: null,
        reel: {
          at: Math.round(RationalTime.toSeconds(slot.start) * 100) / 100,
          seconds: Math.round(RationalTime.toSeconds(slot.duration) * 100) / 100,
        },
      });
      expect(row.slot?.cast?.score).toEqual(expect.any(Number));
      expect(Object.keys(row.slot?.cast?.parts ?? {})).toEqual(
        expect.arrayContaining(['intent', 'motion', 'subject', 'energy', 'quality', 'penalty']),
      );
    });
  });

  it('keeps what the slot is for in the editor’s chat, without casting’s score', async () => {
    const { call, template, projectId, tools, bus } = agentWorld();
    const assembled = await call('timeline.assemble', {
      projectId,
      template: { id: template.id },
      variants: 1,
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const get = tools.tools.find((tool) => tool.name === 'timeline.get')!;
    const docked = { ...agentToolContext(bus, get), editor: { context: {} as never, targets: [] } };
    const ran = await get.run({ timelineId }, docked);
    if (!ran.ok) throw new Error(ran.error.code);
    const rows = (get.output.parse(ran.value) as { clips: Row[] }).clips;
    expect(rows[0]!.slotId).toBeUndefined();
    expect(rows[0]!.slot).toMatchObject({ slot: 1, intent: template.slots[0]!.intent.text });
    expect(rows.every((row) => row.slot && row.slot.cast === undefined)).toBe(true);
  });

  it('leaves the rows as they were without a template to read', async () => {
    const world = agentWorld();
    const assembled = await world.call('timeline.assemble', {
      projectId: world.projectId,
      template: { id: world.template.id },
      variants: 1,
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const timeline = await world.service.read(timelineId as never);
    if (!timeline.ok) throw new Error(timeline.error.code);
    expect(slotFactsOf(timeline.value, null).size).toBe(0);
  });
});

describe('slotFactsOf', () => {
  const template = (): Template => {
    const built = buildTemplate({ slots: [{ frames: 45 }, { frames: 30 }] });
    const [first, second] = built.slots;
    return {
      ...built,
      slots: [
        {
          ...first!,
          intent: {
            ...first!.intent,
            text: `Someone on a phone, ${'held close '.repeat(30)}`,
            needs: ['a phone in hand'],
            face: 'hidden',
            shotType: 'close',
            people: 1,
          },
        },
        second!,
      ],
    };
  };

  it('says the needs and face the Analyst stated, and cuts a long intent', () => {
    const facts = slotFactsOf({ cast: null }, template());
    const [first, second] = [...facts.values()];
    expect(first).toMatchObject({
      slot: 1,
      role: 'hook',
      needs: ['a phone in hand'],
      face: 'hidden',
      shotType: 'close',
      people: 1,
    });
    expect(first!.intent.length).toBe(SLOT_INTENT_CHARS);
    expect(first!.intent.endsWith('…')).toBe(true);
    expect(first!.reel).toEqual({ at: 0, seconds: 1.5 });
    expect(second!.reel).toEqual({ at: 1.5, seconds: 1 });
    expect(first!.cast).toBeUndefined();
  });

  it('gives the cast’s score only while the clip there is still its pick', () => {
    const built = template();
    const slot = built.slots[0]!;
    const clipId = newId<'TimelineItem'>();
    const pick = {
      assetId: newId<'Asset'>(),
      shotId: null,
      sourceStart: RationalTime.of(0, built.canvas.rate),
      syncPoint: null,
      score: 0.71234,
      parts: {
        intent: 0.5,
        motion: 0.1,
        quality: 0.9,
        subject: 0.3333,
        energy: 0.2,
        hook: null,
        rerank: 0.8,
        penalty: 0.05,
      },
    };
    const cast = {
      castId: newId<'Cast'>(),
      mode: 'template' as const,
      variantIndex: 0,
      variantCount: 1,
      configVersion: '1',
      sequenceConfidence: 1,
      slots: [
        { slotId: slot.id, clipId, pick, alternates: [], confidence: 0.8, needsRerank: false, note: null },
      ],
    };
    const kept = slotFactsOf({ cast }, built, new Map([[slot.id, clipId]])).get(slot.id);
    expect(kept?.cast).toEqual({
      score: 0.712,
      parts: {
        intent: 0.5,
        motion: 0.1,
        subject: 0.333,
        energy: 0.2,
        quality: 0.9,
        hook: null,
        rerank: 0.8,
        penalty: 0.05,
      },
    });
    const swapped = slotFactsOf({ cast }, built, new Map([[slot.id, newId<'TimelineItem'>()]])).get(slot.id);
    expect(swapped?.cast).toBeUndefined();
  });
});

describe('slotPlacesOf', () => {
  it('numbers the clips as timeline.get does and says where each slot’s clip sits', async () => {
    const { call, template, projectId, service } = agentWorld();
    const assembled = await call('timeline.assemble', {
      projectId,
      template: { id: template.id },
      variants: 1,
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const timeline = await service.read(timelineId as never);
    if (!timeline.ok) throw new Error(timeline.error.code);
    const places = [...slotPlacesOf(timeline.value).values()];
    expect(places.map((place) => place.clip)).toEqual(template.slots.map((_, index) => index + 1));
    expect(places[0]).toMatchObject({ slotId: template.slots[0]!.id, kind: 'clip', at: 0 });
    expect(places[1]!.at).toBeCloseTo(places[0]!.seconds, 6);
  });
});
