// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's made-up cases start wrong where a first cast goes wrong, and the draft stand-in measures it
 * with render's own slot checks: the phone hook's street shot misses its need, shows a face the reel hides and
 * moves where the reel holds still, and its bubble sits at the top where the reel's is low on the left; the morning
 * chat's beach misses its coffee and its second bubble is missing; the beach run's first need is no shot's. The
 * stand-in model's scripted fixes then match every slot the library can, and video.done passes with a reason for the
 * one it can't.
 */
import { describe, expect, it } from 'vitest';
import { MAKE_CASES } from '../../src/make/cases';
import type { QaCheckResult } from '@taalcut/core';
import { makeWorld } from '../../src/make/world';

const failing = (checks: readonly QaCheckResult[]) =>
  Object.fromEntries(
    checks
      .filter((check) => check.status === 'warn' || check.status === 'fail')
      .map((check) => [
        check.id,
        check.fixes.map((fix) => (fix.kind === 'agent' ? fix.params['slot'] : null)),
      ]),
  );

describe("eval:make's first drafts", () => {
  it('miss the reel where each case says', async () => {
    const seen: Record<string, unknown> = {};
    for (const made of MAKE_CASES) {
      const world = await makeWorld(made);
      seen[made.id] = failing((await world.measure(world.timeline())).checks);
    }
    expect(seen).toMatchInlineSnapshot(`
      {
        "beach-run": {
          "slotMotion": [
            2,
          ],
          "slotNeeds": [
            1,
            2,
          ],
        },
        "morning-chat": {
          "slotFace": [
            2,
          ],
          "slotFraming": [
            2,
          ],
          "slotGraphics": [
            3,
          ],
          "slotMotion": [
            1,
            2,
          ],
          "slotNeeds": [
            1,
          ],
        },
        "phone-hook": {
          "slotFace": [
            1,
          ],
          "slotFraming": [
            1,
            3,
          ],
          "slotGraphics": [
            1,
          ],
          "slotMotion": [
            1,
            3,
          ],
          "slotNeeds": [
            1,
          ],
        },
      }
    `);
  });
});

describe('a make case run', () => {
  it('drafts, fixes what the fixes name, drafts again and finishes with video.done', async () => {
    const { runMakeCase } = await import('../../src/make/run');
    const { standInMaker } = await import('../../src/make/stand-in');
    for (const made of MAKE_CASES) {
      const run = await runMakeCase(made, standInMaker);
      const { caseId, done, rounds, malformed, after, waivedRight, waivedWrong } = run;
      expect({ caseId, done, rounds, malformed, after, waivedRight, waivedWrong }).toEqual({
        caseId: made.id,
        done: true,
        rounds: 2,
        malformed: [],
        waivedRight: made.unmatchable?.length ?? 0,
        waivedWrong: 0,
        after: {
          ...run.before,
          slotsMatched: run.before.slots,
          needsMet: run.before.needs,
          facesHidden: run.before.hidden,
          graphicsPresent: run.before.graphics,
          graphicsPlaced: run.before.graphics,
        },
      });
      expect(run.before.slotsMatched).toBeLessThan(run.before.slots);
    }
  });
});
