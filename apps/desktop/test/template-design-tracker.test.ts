// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GFXWAIT: a make waits for a template's graphics only while they are being designed: done, partly done or
 * failed, it answers how many passed and the overlays left without one; past the deadline, or when the run stops,
 * it answers timedOut and names every overlay as still being designed. A design is settled once.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@taalcut/core';
import { createTemplateDesignTracker } from '../src/utility/roots/template-design-tracker';

const signal = () => new AbortController().signal;

describe('the templates whose graphics are being designed (FIX-GFXWAIT)', () => {
  it('answers null at once when nothing is being designed', async () => {
    const tracker = createTemplateDesignTracker();
    expect(await tracker.wait(newId<'Template'>(), signal())).toBeNull();
  });

  it('waits for a design in flight and says how it went', async () => {
    let clock = 1_000;
    const tracker = createTemplateDesignTracker({ now: () => clock });
    const templateId = newId<'Template'>();
    const settle = tracker.begin(templateId, ['a', 'b']);
    expect(tracker.running(templateId)).toBe(true);
    const waiting = tracker.wait(templateId, signal());
    clock += 4_000;
    settle({ designed: 2, total: 2, missing: [] });
    expect(await waiting).toEqual({
      status: 'designed',
      waitedMs: 4_000,
      designed: 2,
      total: 2,
      missing: [],
    });
    expect(tracker.running(templateId)).toBe(false);
    expect(await tracker.wait(templateId, signal())).toBeNull();
  });

  it('names the overlays a failed or partial design left', async () => {
    const tracker = createTemplateDesignTracker({ now: () => 0 });
    const partial = newId<'Template'>();
    const settlePartial = tracker.begin(partial, ['a', 'b']);
    const waitingPartial = tracker.wait(partial, signal());
    settlePartial({
      designed: 1,
      total: 2,
      missing: [{ overlayId: 'b', reason: 'the bounds check failed' }],
    });
    expect(await waitingPartial).toMatchObject({ status: 'partly', missing: [{ overlayId: 'b' }] });
    const failed = newId<'Template'>();
    const settleFailed = tracker.begin(failed, ['a']);
    const waitingFailed = tracker.wait(failed, signal());
    settleFailed({
      designed: 0,
      total: 1,
      missing: [{ overlayId: 'a', reason: 'the design could not run' }],
    });
    settleFailed({ designed: 1, total: 1, missing: [] });
    expect(await waitingFailed).toMatchObject({ status: 'failed', designed: 0 });
  });

  it('goes on past the deadline, and when the run stops, naming what is still being designed', async () => {
    const tracker = createTemplateDesignTracker({ maxWaitMs: 15 });
    const templateId = newId<'Template'>();
    tracker.begin(templateId, ['a', 'b']);
    const late = await tracker.wait(templateId, signal());
    expect(late).toMatchObject({ status: 'timedOut', designed: 0, total: 2 });
    expect(late?.missing.map((entry) => entry.overlayId)).toEqual(['a', 'b']);
    // Still designing: a later make waits again.
    expect(tracker.running(templateId)).toBe(true);
    const stop = new AbortController();
    const slow = createTemplateDesignTracker({ maxWaitMs: 60_000 });
    slow.begin(templateId, ['a']);
    const waiting = slow.wait(templateId, stop.signal);
    stop.abort();
    expect(await waiting).toMatchObject({ status: 'timedOut' });
  });
});
