// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The LRN1-CTX intent A/B: pairing the arms, the blind sheet and its key, unblinding and scoring. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, templateSchema, type Template } from '@taalcut/core';
import { parseCsv } from '../../src/csv';
import { armsAreSynthetic, firstArm, pairArms, pairSlots, type Arm } from '../../src/intents/ab-arms';
import { syntheticArms } from '../../src/intents/ab-fixtures';
import { scoreAb, signTest, unblind, renderAbMarkdown } from '../../src/intents/ab-score';
import { AB_COLUMNS, abKeySchema, abSheet, type AbKey } from '../../src/intents/ab-sheet';
import { main } from '../../src/intents/cli';

const root = mkdtempSync(join(tmpdir(), 'taalcut-intents-ab-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const arms = syntheticArms();
const asMap = (arm: Arm) => new Map(Object.entries(arms[arm]));
const pairing = () => pairArms(asMap('with'), asMap('without'));

const span = (index: number, start: number, end: number) => ({ index, start, end });

/**
 * A rated sheet: `rate(arm)` gives what the rater answered for that arm's intent. The test reads the key to know
 * which column is which arm; a rater never does.
 */
function rated(csv: string, key: AbKey, rate: (arm: Arm) => { usable: boolean; better: boolean }): string {
  const [header = [], ...rows] = parseCsv(csv).filter((cells) => cells.some((cell) => cell !== ''));
  const col = (name: string) => header.indexOf(name);
  const filled = rows.map((cells, index) => {
    const first = key.rows[index]?.first ?? 'with';
    const second: Arm = first === 'with' ? 'without' : 'with';
    const out = [...cells];
    out[col('usable1')] = rate(first).usable ? 'yes' : 'no';
    out[col('usable2')] = rate(second).usable ? 'YES ' : 'no';
    out[col('better')] = rate(first).better ? '1' : rate(second).better ? '2' : 'same';
    return out.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',');
  });
  return [header.join(','), ...filled].join('\n');
}

const withWins = (arm: Arm) => ({ usable: arm === 'with', better: arm === 'with' });

describe('pairing the arms', () => {
  it('pairs slots by overlap, so a cut judged differently costs only the slots around it', () => {
    // a: 0–30, 30–60, 60–90. b moved the first cut to 33 and added one at 45.
    const paired = pairSlots(
      [span(0, 0, 30), span(1, 30, 60), span(2, 60, 90)],
      [span(0, 0, 33), span(1, 33, 45), span(2, 45, 60), span(3, 60, 90)],
    );
    expect(paired.pairs).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
    expect(paired.unpairedA).toEqual([]);
    expect(paired.unpairedB).toEqual([1]);
  });

  it('leaves a slot unpaired when the best overlap is under half the shorter slot', () => {
    const paired = pairSlots([span(0, 0, 30)], [span(0, 20, 60)]);
    expect(paired.pairs).toEqual([]);
    expect(paired.unpairedA).toEqual([0]);
    expect(paired.unpairedB).toEqual([0]);
  });

  it("shows the reference's text and speech over each slot, the same for both arms", () => {
    const { rows, unpaired } = pairing();
    expect(rows).toHaveLength(7);
    expect(unpaired).toEqual([{ reel: 'talking-tips', with: [], without: [2] }]);
    const tips = rows.filter((row) => row.reel === 'talking-tips');
    expect(tips.map((row) => [row.start, row.end])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
    expect(tips[0]?.onScreen).toBe('3 mistakes beginners make');
    expect(tips[0]?.speech).toBe('three mistakes every beginner makes');
    expect(tips[1]?.intents.without.text).toBe('a person talking in a room');
    expect(tips[2]?.intents.without.text).toBe('a person standing');
  });

  it('refuses arms that are not the same reels', () => {
    const without = asMap('without');
    without.delete('four-slot');
    expect(() => pairArms(asMap('with'), without)).toThrow(/four-slot is in the with arm only/);
  });

  it('refuses arms made from different references', () => {
    const reference = (fingerprint: string): Template =>
      templateSchema.parse({
        ...arms.with['four-slot'],
        origin: {
          kind: 'reference',
          input: 'file',
          platform: null,
          url: null,
          fingerprint,
          source: {
            duration: RationalTime.of(52, FrameRate.of(30)),
            rate: FrameRate.of(30),
            width: 1080,
            height: 1920,
          },
          crop: null,
          pipelineVersion: '1',
          configVersion: '1',
          analysedAt: 0,
        },
      });
    const a = new Map([['four-slot', reference('a'.repeat(64))]]);
    const b = new Map([['four-slot', reference('b'.repeat(64))]]);
    expect(() => pairArms(a, b)).toThrow(/different references/);
    expect(armsAreSynthetic({ with: a, without: a })).toBe(false);
    expect(armsAreSynthetic({ with: a, without: asMap('without') })).toBe(true);
  });
});

describe('the blind sheet', () => {
  it('is the same on every run for a seed and never names an arm', () => {
    const one = abSheet(pairing(), 'seed-1', true);
    const two = abSheet(pairing(), 'seed-1', true);
    expect(two.csv).toBe(one.csv);
    const [header = [], ...rows] = parseCsv(one.csv).filter((cells) => cells.length > 1);
    expect(header).toEqual([...AB_COLUMNS]);
    expect(rows).toHaveLength(7);
    for (const cells of rows)
      expect(cells.filter((cell) => cell === 'with' || cell === 'without')).toEqual([]);
    // The rating columns are left for the rater.
    for (const cells of rows) expect(cells.slice(-3)).toEqual(['', '', '']);
  });

  it('puts each arm first on some rows, as the key records', () => {
    const { csv, key } = abSheet(pairing(), 'lrn1-ctx', true);
    expect(new Set(key.rows.map((row) => row.first))).toEqual(new Set(['with', 'without']));
    const rows = parseCsv(csv).slice(1);
    const intent1 = AB_COLUMNS.indexOf('intent1');
    const { rows: paired } = pairing();
    for (const [index, row] of key.rows.entries()) {
      expect(row.first).toBe(firstArm('lrn1-ctx', row.reel, row.slot));
      expect(rows[index]?.[intent1]).toBe(paired[index]?.intents[row.first].text);
    }
    expect(key).toMatchObject({ suite: 'intents-ab', synthetic: true, unpaired: [{ reel: 'talking-tips' }] });
  });
});

describe('scoring the rated sheet', () => {
  const { csv, key } = abSheet(pairing(), 'lrn1-ctx', true);

  it('unblinds with the key and scores each arm', () => {
    const score = scoreAb(unblind(rated(csv, key, withWins), key), key);
    expect(score.with).toEqual({ usable: 7, rows: 7, share: 1 });
    expect(score.without).toEqual({ usable: 0, rows: 7, share: 0 });
    expect(score.preference).toEqual({ wins: 7, losses: 0, ties: 0 });
    expect(score.signTestP).toBeCloseTo(2 / 128, 10);
    expect(score.perReel.map((reel) => [reel.reel, reel.with.usable, reel.without.usable])).toEqual([
      ['four-slot', 4, 0],
      ['talking-tips', 3, 0],
    ]);
    // Synthetic arms: the gate is computed but never claimed.
    expect(score.envelope).toMatchObject({
      synthetic: true,
      claimed: false,
      gate: { id: 'LRN1-CTX', pass: true },
    });
    const markdown = renderAbMarkdown(score, key);
    expect(markdown).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(markdown).toContain('talking-tips: slots none with, 2 without');
  });

  it('fails the gate when context made the intents no better', () => {
    const same = (arm: Arm) => ({ usable: arm === 'with', better: false });
    const score = scoreAb(unblind(rated(csv, key, same), key), key);
    expect(score.preference).toEqual({ wins: 0, losses: 0, ties: 7 });
    expect(score.signTestP).toBe(1);
    expect(score.envelope.gate?.pass).toBe(false);
  });

  it('refuses a sheet that does not match its key', () => {
    const filled = rated(csv, key, withWins);
    const lines = filled.split('\n');
    expect(() => unblind(lines.slice(0, -1).join('\n'), key)).toThrow(/Rows of the key not rated: 1,/);
    expect(() => unblind([...lines, lines[1] ?? ''].join('\n'), key)).toThrow(/appears twice/);
    expect(() => unblind(filled.replace('four-slot', 'other-reel'), key)).toThrow(/not in the key/);
    const blank = rated(csv, key, withWins).replace(/,yes,/, ',maybe,');
    expect(() => unblind(blank, key)).toThrow(/fill yes or no/);
    expect(() => unblind(filled.replace(/,(1|2)\n/, ',3\n'), key)).toThrow(/fill 1, 2 or same/);
    expect(() => unblind('', key)).toThrow(/empty/);
  });
});

describe('sign test', () => {
  it('is the two-sided binomial tail', () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(3, 3)).toBe(1);
    expect(signTest(10, 2)).toBeCloseTo((2 * (1 + 12 + 66)) / 4096, 12);
    expect(signTest(2, 10)).toBe(signTest(10, 2));
    // Large n stays finite.
    expect(signTest(600, 400)).toBeGreaterThan(0);
    expect(signTest(600, 400)).toBeLessThan(1e-9);
  });
});

describe('the A/B commands', () => {
  it('writes the arms, the sheet and its key, and scores the rated sheet', async () => {
    const armsDir = join(root, 'arms');
    const out = join(root, 'sheet');
    expect(await main(['ab-fixtures', '--out', armsDir])).toBe(0);
    expect(
      await main([
        '--',
        'ab',
        '--',
        '--with',
        join(armsDir, 'with'),
        '--without',
        join(armsDir, 'without'),
        '--out',
        out,
      ]),
    ).toBe(0);
    const key = abKeySchema.parse(JSON.parse(readFileSync(join(out, 'key.json'), 'utf8')));
    // The fixtures are not broken down from a reference, so the key is synthetic without --synthetic.
    expect(key.synthetic).toBe(true);
    const sheet = join(out, 'rated.csv');
    writeFileSync(sheet, rated(readFileSync(join(out, 'sheet.csv'), 'utf8'), key, withWins));
    const report = join(out, 'report.md');
    expect(await main(['ab-score', '--sheet', sheet, '--key', join(out, 'key.json'), '--out', report])).toBe(
      0,
    );
    expect(readFileSync(report, 'utf8')).toContain('| with context | 7/7 (1.000) | met |');
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))).toMatchObject({
      envelope: { suite: 'intents-ab', synthetic: true, claimed: false },
    });
  });

  it('reports a missing flag as a usage error', async () => {
    expect(await main(['ab', '--with', join(root, 'nowhere')])).toBe(1);
    expect(await main(['ab-casting', '--out', join(root, 'cast')])).toBe(1);
  });
});
