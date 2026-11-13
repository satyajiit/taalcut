// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The simulated creator through the app's casting and learning (LRN1-PREF): swaps land in the library's audit log as
 * the bus records a person's, the job writes the learned item through the memory commands, the next videos are cast
 * with it, and the weights move toward what the creator wants, inside the bounds, the same every time. Synthetic.
 */
import {
  MEMORY_COMMANDS,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  type CastingWeights,
} from '@taalcut/core';
import { CASTING_CONFIG, LEARNER_ORIGIN } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { PERSONA } from '../../src/casting-prefs/creator';
import { renderCastingPrefsMarkdown } from '../../src/casting-prefs/report';
import { runCastingPrefs, STAYS_PUT_LIMIT } from '../../src/casting-prefs/run';
import { distance, insideBounds, pairwise, reachable } from '../../src/casting-prefs/score';
import { runPersona, type SimulationOptions } from '../../src/casting-prefs/simulate';
import { createPrefWorld } from '../../src/casting-prefs/world';

const DEFAULTS = CASTING_CONFIG.weights;
const SHORT: SimulationOptions = { rounds: 6, videosPerRound: 5, examTemplates: 16 };

describe('a simulated creator through the app (LRN1-PREF)', () => {
  it('learns what an energy-first creator wants from their swaps, inside the bounds', async () => {
    const who = PERSONA.energyFirst;
    const run = await runPersona(createPrefWorld(42), who, 3, SHORT);
    expect(run.refused).toEqual([]);
    expect(run.writes.length).toBeGreaterThan(0);
    for (const weights of run.writes) expect(insideBounds(weights, DEFAULTS)).toBe(true);
    expect(run.learned.energy).toBeGreaterThan(DEFAULTS.energy);
    expect(distance(run.learned, reachable(who.hidden, DEFAULTS))).toBeLessThan(
      distance(DEFAULTS, reachable(who.hidden, DEFAULTS)),
    );
    expect(pairwise(run.learned, run.exam).rate).toBeGreaterThan(pairwise(DEFAULTS, run.exam).rate);
    // The same log, folded and learned again, gives the item's weights.
    expect(run.relearned).toEqual(run.learned);
    // Once learned, later videos are cast with the learned weights and say so.
    expect(run.rounds.at(-1)?.castWith).toMatch(
      new RegExp(`^${CASTING_CONFIG.version.replace('.', '\\.')}\\+learned@\\d+$`),
    );
    expect(run.rounds[0]?.castWith).toBe(CASTING_CONFIG.version);
  });

  it('records swaps as the bus records a person’s, with the score parts shown, and the job’s writes as memory commands', async () => {
    const run = await runPersona(createPrefWorld(7), PERSONA.qualityFirst, 1, { ...SHORT, rounds: 2 });
    const swaps = run.log.filter((entry) => entry.name === TIMELINE_COMMANDS.swapClip);
    expect(swaps.length).toBeGreaterThan(0);
    for (const entry of swaps) {
      expect(entry).toMatchObject({
        source: 'ui',
        actor: 'person',
        inverse: { name: TIMELINE_COMMANDS.restore },
      });
      const payload = timelineCommandPayloads[TIMELINE_COMMANDS.swapClip].parse(entry.payload);
      expect(payload).toMatchObject({
        from: 'alternate',
        scored: { parts: { quality: expect.any(Number) } },
      });
    }
    const writes = run.log.filter((entry) => entry.actor === LEARNER_ORIGIN.actor);
    expect(writes.map((entry) => entry.name)).toEqual(
      writes.map((_, index) => (index === 0 ? MEMORY_COMMANDS.create : MEMORY_COMMANDS.update)),
    );
  });

  it('runs the same twice: the same seed gives the same swaps and the same weights', async () => {
    const who = PERSONA.motionFirst;
    const first = await runPersona(createPrefWorld(1234), who, 0, { ...SHORT, rounds: 3 });
    const again = await runPersona(createPrefWorld(1234), who, 0, { ...SHORT, rounds: 3 });
    expect(again.rounds).toEqual(first.rounds);
    expect(again.writes).toEqual(first.writes);
    expect(JSON.stringify(again.exam)).toBe(JSON.stringify(first.exam));
  });

  it('leaves the weights near casting.v1 for a creator who casts like casting.v1', async () => {
    const run = await runPersona(createPrefWorld(42), PERSONA.likeCastingV1, 4, SHORT);
    const moved: CastingWeights = run.learned;
    expect(distance(moved, DEFAULTS)).toBeLessThanOrEqual(STAYS_PUT_LIMIT);
  });
});

describe('the casting-preferences report (LRN1-PREF)', () => {
  it('pools the exams, checks every promise and says it is synthetic', async () => {
    const report = await runCastingPrefs({
      seeds: [42],
      rounds: 4,
      videosPerRound: 5,
      examTemplates: 12,
      personas: [PERSONA.energyFirst, PERSONA.likeCastingV1],
    });
    expect(report).toMatchObject({ suite: 'casting-prefs', synthetic: true, claimed: false });
    expect(report.personas).toHaveLength(2);
    expect(report.checks).toMatchObject({
      insideBounds: true,
      sameLogSameWeights: true,
      rerunIdentical: true,
    });
    expect(report.pooled.slots).toBe(report.personas.reduce((sum, run) => sum + run.examSlots, 0));
    const markdown = renderCastingPrefsMarkdown(report);
    expect(markdown).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(markdown).toContain('| 42 | energy-first |');
  });
});
