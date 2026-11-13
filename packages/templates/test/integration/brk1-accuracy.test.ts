// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC through the whole pipeline, on scripted analysers (helpers/scripted-analysers.ts, a made-up reel with the
 * kinds of trouble REF1 met): one shot drifting, a fade's tail, scene text, a hallucinated line, and the doubts the
 * review reads.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createManualClock,
  newId,
  RationalTime,
  templateSchema,
  type ExperimentId,
  type Template,
} from '@taalcut/core';
import {
  buildTemplate,
  resolveCuts,
  runBreakdown,
  type BreakdownDraft,
  type SlotIntentInput,
} from '../../src/index';
import { withSlotContext } from '../../src/breakdown/slot-context';
import { checkAnalystHandoff, unconfirmedCutsOf } from '../../src/skills/analyst';
import { sequentialIds } from '../helpers/fixtures';
import { SCRIPTED, scriptedAnalysers, type ScriptOptions } from '../helpers/scripted-analysers';

const root = mkdtempSync(join(tmpdir(), 'taalcut-brk1-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function breakDown(options: ScriptOptions = {}, sound: { title: string; artist: null } | null = null) {
  const draft = await runBreakdown(
    {
      breakdownId: newId(),
      referencePath: join(root, 'reel.mp4'),
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/EXAMPLE123/',
      sound,
      fingerprint: 'b'.repeat(64),
    },
    { ...scriptedAnalysers(options), experimentDir: root, clock: createManualClock(1) },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${draft.error.code}: ${draft.error.detail ?? ''}`);
  return draft.value;
}

const cutsOf = (draft: BreakdownDraft) =>
  [...draft.cuts, ...draft.disputes.filter((dispute) => dispute.ruleKeeps)]
    .map((cut) => cut.frame)
    .sort((a, b) => a - b);

function template(draft: BreakdownDraft, intents: readonly SlotIntentInput[] = []): Template {
  const built = buildTemplate(draft, [], intents, sequentialIds(), { createdAt: 1 });
  if (!built.ok) throw new Error(built.error.detail ?? built.error.code);
  return built.value;
}

describe('BRK1-ACC on a made-up reel with the trouble REF1 met', () => {
  it('finds the hard cuts and no cut inside the walking shot or the fade’s tail', async () => {
    const draft = await breakDown();
    expect(cutsOf(draft)).toEqual([...SCRIPTED.hardCuts]);
  });

  it('keeps the chat bubbles and drops the sign, the shirt and the billboards', async () => {
    const draft = await breakDown();
    expect(draft.text.map((overlay) => overlay.text).sort()).toEqual(['Soon...', 'Where to next?']);
    expect(draft.text.every((overlay) => overlay.doubts === undefined)).toBe(true);
  });

  it('rejects Whisper’s bracketed hallucination on the music, and keeps real speech', async () => {
    const hallucinated = await breakDown();
    expect(hallucinated.audio.speech).toBeNull();
    expect(hallucinated.audio.kind).toBe('music');
    const spoken = await breakDown({
      speech: [{ startMs: 500, endMs: 3_000, text: 'we finally made it to the city' }],
    });
    expect(spoken.audio.speech?.segments.map((segment) => segment.text)).toEqual([
      'we finally made it to the city',
    ]);
  });

  it('asks for the sound credit when the platform gives none, and not when it does', async () => {
    const none = template(await breakDown());
    expect(none.doubts?.map((doubt) => doubt.reason)).toContain('soundCreditMissing');
    const credited = template(await breakDown({}, { title: 'Made-up song', artist: null }));
    expect(credited.doubts?.map((doubt) => doubt.reason) ?? []).not.toContain('soundCreditMissing');
  });

  it('marks speech kept on music without voice activity to back it', async () => {
    const draft = await breakDown({ speech: [{ startMs: 500, endMs: 1_500, text: 'let us go now' }] });
    expect(template(draft).doubts?.map((doubt) => doubt.reason)).toContain('speechMaybeHallucinated');
  });

  it('has a steady tempo: no half-or-double doubt', async () => {
    const draft = await breakDown();
    expect(template(draft).doubts?.map((doubt) => doubt.reason) ?? []).not.toContain(
      'tempoMaybeHalfOrDouble',
    );
    expect(draft.beatMap?.beatsPerBar).toBe(4);
  });

  it('marks vague intents: no subject, no motion, or the same words as another slot', async () => {
    const draft = await breakDown();
    const vague = {
      text: 'building, static, branding',
      shotType: 'wide' as const,
      motion: 'static' as const,
    };
    const intents: SlotIntentInput[] = [
      {
        slotIndex: 0,
        intent: {
          text: 'a woman ties her shoes on a bench, then stands and jogs off as the camera follows',
          shotType: 'medium',
          motion: 'tracking',
          subject: 'woman in running gear',
          people: 1,
          place: 'park',
          energy: 0.4,
        },
      },
      { slotIndex: 1, intent: { ...vague, subject: null, people: null, place: null, energy: 0.5 } },
      { slotIndex: 2, intent: { ...vague, subject: 'building', people: null, place: null, energy: 0.5 } },
      { slotIndex: 3, intent: { ...vague, subject: 'building', people: null, place: null, energy: 0.5 } },
    ];
    const reasons = template(draft, intents).slots.map((slot) =>
      (slot.doubts ?? []).map((doubt) => doubt.reason),
    );
    expect(reasons[0]).not.toContain('intentVague');
    expect(reasons[1]).toContain('intentVague');
    expect(reasons[2]).toContain('intentVague');
    expect(reasons[3]).toContain('intentVague');
  });

  it('tells the Analyst the camera’s move, measured: still, a pan right, a follow, still', async () => {
    const draft = await breakDown();
    const contexts = withSlotContext(draft, resolveCuts(draft, []).slots).map(
      ({ context }) => context.camera,
    );
    expect(contexts).toEqual([
      'static: the camera holds still (a subject may move)',
      'pan right',
      'tracking: the camera follows the subject, who stays in frame (moving right)',
      'static: the camera holds still (a subject may move)',
    ]);
    // The fade's tail is no part of the last shot's move.
    expect(draft.camera?.segments.find((segment) => segment.start === SCRIPTED.fadeFrom)?.fade).toBe(true);
  });

  it('takes each slot’s motion from the measure, whatever an intent from before said', async () => {
    const draft = await breakDown();
    const subjects = ['a man on a bench', 'a street of shops', 'a man walking', 'a billboard wall'];
    const intents: SlotIntentInput[] = subjects.map((subject, slotIndex) => ({
      slotIndex,
      intent: {
        text: `${subject}, seen whole, the camera still on it`,
        shotType: 'wide',
        motion: 'static',
        subject,
        people: null,
        place: 'street',
        energy: 0.3,
      },
    }));
    const built = template(draft, intents);
    expect(built.slots.map((slot) => slot.intent.motion)).toEqual(['static', 'pan', 'tracking', 'static']);
    expect(built.slots.map((slot) => slot.motionMeasure?.label)).toEqual([
      'static',
      'pan',
      'tracking',
      'static',
    ]);
    expect(built.slots[1]!.motionMeasure!.panX).toBeCloseTo(0.12, 5);
    expect(built.slots.flatMap((slot) => slot.doubts ?? []).map((doubt) => doubt.reason)).not.toContain(
      'motionUnsure',
    );
    expect(templateSchema.safeParse(built).success).toBe(true);
  });

  it('leaves an unsure move unknown for the review to ask, and the Analyst’s check passes it', async () => {
    const draft = await breakDown();
    // The street's pairs mostly unreadable: the measure can't be sure.
    const camera = {
      ...draft.camera!,
      segments: draft.camera!.segments.map((segment) =>
        segment.start === 170
          ? { ...segment, pairs: segment.pairs.map((pair, i) => (i > 0 ? pair.slice(0, 2) : pair)) }
          : segment,
      ),
    };
    const intents: SlotIntentInput[] = [
      'a man on a bench',
      'a street of shops',
      'a man walking',
      'a wall',
    ].map((subject, slotIndex) => ({
      slotIndex,
      intent: {
        text: `${subject}, seen whole from across the street`,
        shotType: 'wide',
        subject,
        people: null,
        place: 'street',
        energy: 0.3,
      },
    }));
    const built = template({ ...draft, camera }, intents);
    expect(built.slots[1]!.intent.motion).toBeNull();
    expect(built.slots[1]!.doubts?.map((doubt) => doubt.reason)).toContain('motionUnsure');
    const output = {
      templateId: built.id,
      version: built.version,
      slotCount: built.slots.length,
      breakdownId: draft.breakdownId as ExperimentId,
      unconfirmedCuts: unconfirmedCutsOf(built),
    };
    expect(checkAnalystHandoff(output, built, true)).toEqual({ verdict: 'pass' });
    // Without a shot type a slot is still open.
    const open = {
      ...built,
      slots: built.slots.map((slot, i) =>
        i === 1 ? { ...slot, intent: { ...slot.intent, shotType: null } } : slot,
      ),
    };
    expect(checkAnalystHandoff(output, open, true)).toMatchObject({ verdict: 'fail' });
  });

  it('keeps the canvas landscape and the slots on the frames it found', async () => {
    const built = template(await breakDown());
    expect(built.canvas.width).toBeGreaterThan(built.canvas.height);
    expect(built.slots.map((slot) => RationalTime.toFrames(slot.start, built.canvas.rate))).toEqual([
      0,
      ...SCRIPTED.hardCuts,
    ]);
  });
});
