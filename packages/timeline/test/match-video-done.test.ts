// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: video.done's verdict. It refuses without a draft of the timeline as it is, while a slot fails a slot-match
 * check with no reason given for it, and while a check the person may not export over fails; a slot left with a
 * reason, and an overridden check, pass. The refusal names each failing slot with its fix's words.
 */
import { describe, expect, it } from 'vitest';
import { newId, type QaCheckResult, type QaReport } from '@taalcut/core';
import { checkVideoDone, type VideoDoneInput } from '../src/match/video-done';
import { buildTimeline } from './fixtures/timeline';

const built = buildTimeline({ clips: [{ frames: 30 }, { frames: 45 }, { frames: 30, gap: true }] });
const timeline = built.timeline;
const slots = built.slots.map((id) => ({ id: id as string }));
const renderId = newId<'Render'>();

const check = (
  id: QaCheckResult['id'],
  status: QaCheckResult['status'],
  extra: Partial<QaCheckResult> = {},
) =>
  ({
    id,
    status,
    labelKey: `qa.checks.${id}`,
    findings: [],
    overridable: true,
    fixes: [],
    durationMs: 0,
    ...extra,
  }) as QaCheckResult;

const report = (checks: QaCheckResult[], overrides: QaReport['overrides'] = []): QaReport => ({
  version: 1,
  renderId,
  round: 1,
  verdict: 'needsAttention',
  presetId: 'reels',
  checks,
  overrides,
  createdAt: 0,
});

const facing = check('slotFace', 'warn', {
  findings: [
    {
      frames: { start: 30, end: 75 },
      target: { kind: 'clip', id: built.ids[1]! },
      measured: { value: 62, unit: 'percent' },
    },
  ],
  fixes: [
    {
      kind: 'agent',
      instructionKey: 'qa.fixes.matchSlotFace',
      params: {
        slot: 2,
        slotId: slots[1]!.id,
        wanted: 'hidden',
        facePct: 62,
        tools: 'timeline.slipClip, timeline.setReframe',
      },
    },
  ],
});
// A slot no clip fills: its finding names the slot itself.
const needing = check('slotNeeds', 'warn', {
  findings: [{ target: { kind: 'clip', id: slots[2]!.id }, measured: { value: 1, unit: 'count' } }],
});

const input = (overrides: Partial<VideoDoneInput> = {}): VideoDoneInput => ({
  timeline,
  slots,
  draft: {
    renderId,
    timelineRevision: timeline.revision,
    report: report([facing, needing, check('loudness', 'pass')]),
  },
  reasons: [],
  ...overrides,
});

describe('checkVideoDone', () => {
  it('refuses without a draft, or with a draft of another revision', () => {
    expect(checkVideoDone(input({ draft: null })).verdict).toMatchObject({ verdict: 'retry' });
    const stale = checkVideoDone(
      input({ draft: { renderId, timelineRevision: timeline.revision + 1, report: null } }),
    );
    expect(stale.verdict).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('render.draft revision'),
    });
  });

  it('names each failing slot with what differs and the tools its fix names', () => {
    const outcome = checkVideoDone(input());
    expect(outcome.compared).toBe(true);
    const reason = outcome.verdict.verdict === 'retry' ? outcome.verdict.reason : '';
    expect(reason).toContain(
      'slot 2: slotFace (wanted=hidden, facePct=62, tools=timeline.slipClip, timeline.setReframe)',
    );
    expect(reason).toContain('slot 3: slotNeeds (1 count)');
  });

  it("words each of a slot's findings with its own fix (two reel graphics in one slot)", () => {
    const fix = (overlayId: string) => ({
      kind: 'agent' as const,
      instructionKey: 'qa.fixes.matchSlotGraphics',
      params: { slot: 1, slotId: slots[0]!.id, overlayId, missing: 1, tools: 'graphics.design' },
    });
    const finding = {
      target: { kind: 'clip' as const, id: built.ids[0]! },
      measured: { value: 1, unit: 'count' as const },
    };
    const graphics = check('slotGraphics', 'warn', {
      findings: [finding, finding],
      fixes: [fix('first'), fix('second')],
    });
    const outcome = checkVideoDone(
      input({ draft: { renderId, timelineRevision: timeline.revision, report: report([graphics]) } }),
    );
    const reason = outcome.verdict.verdict === 'retry' ? outcome.verdict.reason : '';
    expect(reason).toContain(
      'slot 1: slotGraphics (overlayId=first, missing=1, tools=graphics.design); slotGraphics (overlayId=second, missing=1',
    );
  });

  it('passes once every failing slot has a reason, and lists those slots as waived', () => {
    const outcome = checkVideoDone(
      input({
        reasons: [
          { slot: 2, reason: 'the person asked for this shot' },
          { slot: 3, reason: 'no clip shows it' },
        ],
      }),
    );
    expect(outcome.verdict).toEqual({ verdict: 'pass' });
    expect(outcome.waived).toEqual([2, 3]);
  });

  it('keeps a slot without a reason open, maps a finding by its frames, and passes an overridden check', () => {
    const byFrames = check('slotTiming', 'warn', {
      findings: [{ frames: { start: 10, end: 30 }, measured: { value: -0.4, unit: 'seconds' } }],
    });
    const draft = { renderId, timelineRevision: timeline.revision, report: report([byFrames]) };
    const open = checkVideoDone(input({ draft, reasons: [{ slot: 2, reason: 'not this one' }] }));
    expect(open.verdict).toMatchObject({
      reason: expect.stringContaining('slot 1: slotTiming (-0.4 seconds)'),
    });
    const overridden = {
      ...draft,
      report: report([byFrames], [{ check: 'slotTiming', at: 1, actor: 'user' }]),
    };
    expect(checkVideoDone(input({ draft: overridden })).verdict).toEqual({ verdict: 'pass' });
  });

  it('never waives a check the person may not export over, and waives an overridable one with a reason', () => {
    const avSync = check('avSync', 'fail', {
      overridable: false,
      fixes: [{ kind: 'auto', action: 'remux' }],
    });
    const beatSync = check('beatSync', 'fail');
    const draft = { renderId, timelineRevision: timeline.revision, report: report([avSync, beatSync]) };
    const refused = checkVideoDone(
      input({
        draft,
        reasons: [
          { check: 'avSync', reason: 'x' },
          { check: 'beatSync', reason: 'y' },
        ],
      }),
    );
    expect(refused.verdict).toMatchObject({
      reason: expect.stringContaining('avSync (must be fixed): remux'),
    });
    expect(refused.verdict).not.toMatchObject({ reason: expect.stringContaining('beatSync') });
    expect(
      checkVideoDone(
        input({
          draft: { ...draft, report: report([beatSync]) },
          reasons: [{ check: 'beatSync', reason: 'y' }],
        }),
      ).verdict,
    ).toEqual({ verdict: 'pass' });
  });

  it('says when the draft was not compared with its reel', () => {
    const draft = {
      renderId,
      timelineRevision: timeline.revision,
      report: report([check('slotNeeds', 'skipped')]),
    };
    expect(checkVideoDone(input({ draft }))).toMatchObject({ verdict: { verdict: 'pass' }, compared: false });
  });
});

describe('checkVideoDone and QA warnings', () => {
  it('ignores a warning that is no slot check (slot checks warn, and are held: above)', () => {
    const loud = check('loudness', 'warn');
    const draft = { renderId, timelineRevision: timeline.revision, report: report([loud]) };
    expect(checkVideoDone(input({ draft })).verdict).toEqual({ verdict: 'pass' });
  });
});
