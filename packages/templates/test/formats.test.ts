// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T7: Vlog and Day in the life give valid slot plans for 15, 30 and 60 s (and 6 and 90). */
import { describe, expect, it } from 'vitest';
import { FrameRates, RationalTime, templateSchema, type Template } from '@taalcut/core';
import {
  allocateBeats,
  FORMAT_SUMMARIES,
  getFormat,
  planFormat,
  splitFill,
  VLOG_SECTIONS,
} from '../src/index';
import { countingIds } from './formats/helpers';
import { json, sequentialIds } from './helpers/fixtures';

/** Fixed ULIDs from a counter, so two runs make identical documents. */
const frames = (time: RationalTime) => time.value;

function beatsOf(template: Template) {
  return template.beatMap!.beats.map(frames);
}

describe.each(['vlog', 'dayInTheLife'] as const)('%s', (formatId) => {
  it.each([6, 15, 30, 60, 90])('plans %i s: valid, exact, on beats, hook first and short', (seconds) => {
    const planned = planFormat({ formatId, targetSeconds: seconds, createdAt: 5 }, sequentialIds());
    expect(planned.ok).toBe(true);
    const template = planned.ok ? planned.value : (undefined as never);
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
    expect(frames(template.duration)).toBe(seconds * 30);
    expect(template.origin).toMatchObject({ kind: 'format', formatId, brief: null });
    const beats = beatsOf(template);
    for (const slot of template.slots) {
      expect(beats).toContain(frames(slot.start));
      expect(slot.cut).toEqual({ method: 'format', confidence: 1 });
      expect(slot.intent.source).toBe('format');
      expect(slot.beatAnchor?.offset.value).toBe(0);
    }
    const [hook, ...rest] = template.slots;
    expect(hook!.role).toBe('hook');
    expect(frames(hook!.duration)).toBeLessThanOrEqual(45);
    expect(rest.at(-1)!.role).toBe('outro');
    // The last slot is at least two beats (15 frames each at 120 BPM).
    expect(frames(rest.at(-1)!.duration)).toBeGreaterThanOrEqual(30);
    expect(template.pacing.cutsOnBeat).toBe(1);
    expect(template.contactSheet).toBeNull();
  });

  it("keeps every text box inside every export preset's safe rect", () => {
    // render's cross-post rect (presets/safe-zones.v1.json, all platforms intersected) on the 1080 × 1920 canvas.
    const safe = { left: 120 / 1080, top: 288 / 1920, right: 780 / 1080, bottom: 1248 / 1920 };
    const planned = planFormat({ formatId, targetSeconds: 30, createdAt: 5 }, sequentialIds());
    const template = planned.ok ? planned.value : (undefined as never);
    expect(template.text.length).toBeGreaterThan(0);
    for (const { box } of template.text) {
      expect(box.x).toBeGreaterThanOrEqual(safe.left);
      expect(box.y).toBeGreaterThanOrEqual(safe.top);
      expect(box.x + box.width).toBeLessThanOrEqual(safe.right);
      expect(box.y + box.height).toBeLessThanOrEqual(safe.bottom);
    }
  });

  it('is deterministic with an injected id factory and slices long briefs to 500 characters', () => {
    const a = planFormat({ formatId, targetSeconds: 30, brief: 'Goa trip' }, countingIds());
    const b = planFormat({ formatId, targetSeconds: 30, brief: 'Goa trip' }, countingIds());
    expect(a).toEqual(b);

    const longBrief = 'b'.repeat(900);
    const sliced = planFormat({ formatId, targetSeconds: 30, brief: longBrief }, countingIds());
    expect(sliced.ok).toBe(true);
    if (sliced.ok && sliced.value.origin.kind === 'format') {
      expect(sliced.value.origin.brief).toHaveLength(500);
      expect(sliced.value.origin.brief).toBe('b'.repeat(500));
    }
  });

  it('keeps NTSC exact and fills a non-integer beat grid', () => {
    const planned = planFormat(
      { formatId, targetSeconds: 30, rate: FrameRates.fps29_97, bpm: 128 },
      sequentialIds(),
    );
    expect(planned.ok).toBe(true);
    const template = planned.ok ? planned.value : (undefined as never);
    expect(template.canvas.rate).toEqual(FrameRates.fps29_97);
    expect(frames(template.duration)).toBe(RationalTime.fromSeconds(30, FrameRates.fps29_97).value);
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
  });

  it('refuses targets outside 6–120 s and tempos outside 80–180 BPM', () => {
    const short = planFormat({ formatId, targetSeconds: 5 }, sequentialIds());
    expect(!short.ok && short.error).toMatchObject({
      code: 'templates.format_target',
      params: { min: 6, max: 120 },
    });
    const slow = planFormat({ formatId, targetSeconds: 30, bpm: 40 }, sequentialIds());
    expect(!slow.ok && slow.error.code).toBe('core.validation');
  });
  it('fits an explicit slot or clip count requested in the brief', () => {
    const planned = planFormat(
      {
        formatId: 'vlog',
        targetSeconds: 48,
        bpm: 100,
        brief: 'First owned home after 10+ years renting. Exactly 12 slots, one per selected clip.',
      },
      sequentialIds(),
    );
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.value.slots).toHaveLength(12);
      expect(frames(planned.value.duration)).toBe(48 * 30);
    }
  });
});

describe('format roles', () => {
  const roles = (template: Template) => template.slots.map((slot) => slot.role);

  it('vlog: hook, establishing, journey, two or three peaks, outro, with the place title', () => {
    const planned = planFormat({ formatId: 'vlog', targetSeconds: 60 }, sequentialIds());
    const template = planned.ok ? planned.value : (undefined as never);
    const order = roles(template);
    expect(order[0]).toBe('hook');
    expect(order.at(-1)).toBe('outro');
    expect(order.filter((role) => role === 'peak')).toHaveLength(3);
    expect(order.lastIndexOf('body')).toBeLessThan(order.indexOf('peak'));
    expect(template.text.map((item) => item.text)).toEqual(['{place}']);
    expect(template.text[0]!.slotId).toBe(template.slots[1]!.id);
    // Journey energy rises.
    const journey = template.slots.slice(2, order.indexOf('peak')).map((slot) => slot.intent.energy);
    expect(journey).toEqual([...journey].sort((a, b) => a - b));
  });

  it('day in the life: a {time} label at the start of each part', () => {
    const planned = planFormat({ formatId: 'dayInTheLife', targetSeconds: 60 }, sequentialIds());
    const template = planned.ok ? planned.value : (undefined as never);
    expect(template.text.map((item) => item.text)).toEqual([
      '{time}',
      '{time}',
      '{time}',
      '{time}',
      '{time}',
    ]);
    expect(roles(template)[0]).toBe('hook');
  });

  it('lists every format with its limits', () => {
    expect(
      FORMAT_SUMMARIES.map((format) => [format.id, format.defaultBpm, format.audio, format.captions]),
    ).toEqual([
      ['vlog', 120, 'music', 'optional'],
      ['dayInTheLife', 120, 'music', 'optional'],
      ['talkingHead', 100, 'voice', 'required'],
      ['podcastClip', 100, 'voice', 'required'],
      ['ugcAd', 120, 'music', 'recommended'],
      ['beforeAfter', 120, 'music', 'optional'],
      ['tutorial', 100, 'voice', 'recommended'],
      ['highlightReel', 128, 'music', 'optional'],
    ]);
    expect(getFormat('vlog').ok).toBe(true);
    expect(getFormat('podcast').ok).toBe(false);
  });
});

describe('beat allocation', () => {
  it('splits a fill into body lengths, longer first', () => {
    expect(splitFill(10, { min: 2, pref: 3, max: 4 })).toEqual([4, 3, 3]);
    expect(splitFill(1, { min: 2, pref: 3, max: 4 })).toEqual([]);
    expect(splitFill(7, { min: 3, pref: 4, max: 6 })).toEqual([4, 3]);
  });

  it('shrinks to fit a crowded target and refuses an impossible one', () => {
    const options = { seconds: 6, hookBeats: 2, body: { min: 2, pref: 3, max: 4 } };
    const plan = allocateBeats(VLOG_SECTIONS, 12, options)!;
    expect(plan.reduce((sum, slot) => sum + slot.beats, 0)).toBe(12);
    expect(allocateBeats(VLOG_SECTIONS, 3, options)).toBeNull();
  });
});
