// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The style profile suite (LRN1-STY): the synthetic set is byte-identical on rerun, matches its hand-computed
 * numbers, and QA's stylePacing passes the renders made like each set and fails the others; the report says it is
 * synthetic and claims nothing. A wrong hand count or a wrong verdict fails the gate.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../../src/style-profile/cli';
import { SYNTHETIC_STYLE_CASES, writeStyleProfileFixtures } from '../../src/style-profile/fixtures';
import { scoreStyleProfiles } from '../../src/style-profile/run';
import { loadStyleProfileCases, type StyleProfileCase } from '../../src/style-profile/schema';

const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-style-eval-'));
  dirs.push(dir);
  return dir;
};

describe('the style profile suite', () => {
  it('passes the synthetic set, and says it is synthetic', () => {
    const report = scoreStyleProfiles(SYNTHETIC_STYLE_CASES);
    for (const row of report.cases) {
      expect(row.deterministic).toBe(true);
      expect(row.mismatches).toEqual([]);
      for (const render of row.renders) expect(render.got).toBe(render.expect);
    }
    expect(report).toMatchObject({
      suite: 'style-profile',
      synthetic: true,
      claimed: false,
      gate: { pass: true },
    });
    expect(report.cases.find((row) => row.caseId === 'quick-cuts')?.renders[0]).toMatchObject({
      name: 'made-like-it',
      medianSeconds: 1,
    });
  });

  it('fails the gate on a wrong hand count or a wrong verdict', () => {
    const [first] = SYNTHETIC_STYLE_CASES;
    if (!first) throw new Error('no synthetic case');
    const miscounted: StyleProfileCase = {
      ...first,
      expected: { ...first.expected, shot: { ...first.expected.shot, median: 1.2 } },
    };
    const misjudged: StyleProfileCase = {
      ...first,
      caseId: 'misjudged',
      renders: [{ name: 'too-slow', fps: 30, shots: [45, 60, 60, 75], expect: 'pass' }],
    };
    const report = scoreStyleProfiles([miscounted, misjudged]);
    expect(report.gate.pass).toBe(false);
    expect(report.cases[0]?.mismatches[0]).toMatch(/^shot: expected/);
    expect(report.cases[1]?.renders[0]).toMatchObject({ expect: 'pass', got: 'fail' });
  });

  it('refuses a label whose template is not one, naming the file', () => {
    const labels = temp();
    const [first] = SYNTHETIC_STYLE_CASES;
    if (!first) throw new Error('no synthetic case');
    const broken = { ...first, templates: [{ schemaVersion: 1, slots: 'none' }] };
    writeFileSync(join(labels, 'broken.json'), JSON.stringify([broken]));
    expect(() => loadStyleProfileCases(labels)).toThrow(/broken\.json[\s\S]*not a template/);
  });

  it('writes the labels and the report from the command line', () => {
    const labels = temp();
    writeStyleProfileFixtures(labels);
    // The labels hold the templates as the app exports them, and read back as the same templates.
    expect(loadStyleProfileCases(labels)).toEqual(SYNTHETIC_STYLE_CASES);
    const out = join(temp(), 'style-profile.md');
    expect(main(['eval', '--labels', labels, '--out', out])).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(JSON.parse(readFileSync(out.replace(/\.md$/, '.json'), 'utf8'))).toMatchObject({
      claimed: false,
    });
  });
});
