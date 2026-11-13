// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-I3: a listening suite's numbers against its ci-paths bars, and what a skip or a crash reports. */
import { describe, expect, it } from 'vitest';
import { barsOf, crashed, envelopeOf, judge, outcomeOf } from '../../src/listening/outcome';
import { formatValue, renderOutcome, renderSummary } from '../../src/listening/report';

describe('listening outcomes', () => {
  it('passes a higher-is-better number at or above its bar and a lower-is-better one at or below', () => {
    const bars = { up: 0.9, down: 0.05 };
    expect(judge({ name: 'up', value: 0.9, better: 'higher', part: 'p' }, bars).pass).toBe(true);
    expect(judge({ name: 'up', value: 0.89, better: 'higher', part: 'p' }, bars).pass).toBe(false);
    expect(judge({ name: 'down', value: 0.05, better: 'lower', part: 'p' }, bars).pass).toBe(true);
    expect(judge({ name: 'down', value: 0.051, better: 'lower', part: 'p' }, bars).pass).toBe(false);
    expect(judge({ name: 'down', value: Number.NaN, better: 'lower', part: 'p' }, bars).pass).toBeUndefined();
    expect(judge({ name: 'free', value: 3, better: 'higher', part: 'p' }, bars)).not.toHaveProperty('bar');
  });

  it('reads each suite’s bars from ci-paths.json', () => {
    expect(barsOf('listen-pick')).toEqual({ top5FamilyRate: 0.85 });
    expect(barsOf('listen-mood')).toEqual({ top3MoodRate: 0.7 });
    expect(barsOf('listen-breakdown-hits').cutSyncAgreement).toBe(0.9);
    expect(barsOf('listen-parity').syncStatusAgreement).toBe(1);
  });

  it('skips a suite that measured nothing, with the reason, and claims nothing', () => {
    const outcome = outcomeOf('listen-mood', {
      metrics: [],
      skipped: [{ part: 'tracks', reason: 'no labelled set' }],
      seconds: 0,
    });
    expect(outcome).toMatchObject({ status: 'skipped', detail: 'no labelled set', features: ['EAR1-B3'] });
    expect(envelopeOf(outcome)).toMatchObject({ claimed: false, gate: { pass: true }, metrics: [] });
    expect(renderOutcome(outcome)).toContain('- tracks: no labelled set');
  });

  it('fails on any bar missed or any judged number missing, and keeps a skipped part beside the rest', () => {
    const pass = outcomeOf('listen-parity', {
      metrics: [
        { name: 'onsetMatchRate', value: 0.99, better: 'higher', part: 'dsp' },
        { name: 'audioOnly', value: 0.4, better: 'higher', part: 'dsp' },
      ],
      skipped: [{ part: 'end to end', reason: 'no listen models' }],
      seconds: 1,
    });
    expect(pass.status).toBe('pass');
    expect(pass.detail).toBe('1/1 bars met (dsp); skipped: end to end');
    const fail = outcomeOf('listen-parity', {
      metrics: [
        { name: 'onsetMatchRate', value: 0.97, better: 'higher', part: 'dsp' },
        { name: 'keyAgreement', value: null, better: 'higher', part: 'dsp' },
      ],
      seconds: 1,
    });
    expect(fail.status).toBe('fail');
    expect(fail.detail).toBe('0/2 bars met (dsp); below: onsetMatchRate, keyAgreement');
    expect(envelopeOf(fail)).toMatchObject({
      claimed: true,
      gate: { id: 'EAR1-F5 EAR1-F6 EAR1-A1', pass: false },
    });
    expect(envelopeOf(fail).metrics).toEqual([{ name: 'onsetMatchRate', value: 0.97, better: 'higher' }]);
  });

  it('turns a crash into a failure with its message', () => {
    const outcome = crashed('listen-breakdown-hits', new Error('film-00: no cuts'), 2);
    expect(outcome).toMatchObject({
      status: 'fail',
      detail: 'error: film-00: no cuts',
      features: ['EAR1-C1'],
    });
    expect(renderSummary([outcome])).toContain(
      '| listen-breakdown-hits | EAR1-C1 | fail | error: film-00: no cuts |',
    );
  });

  it('prints small numbers so they can be read', () => {
    expect([formatValue(1), formatValue(0.98765), formatValue(2.5e-6), formatValue(null)]).toEqual([
      '1',
      '0.9877',
      '2.50e-6',
      '–',
    ]);
  });
});
