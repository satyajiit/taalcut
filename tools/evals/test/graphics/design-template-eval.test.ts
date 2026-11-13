// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * eval:design --template with the stand-ins (HFW1 tpl): every made-up reel read as a template, its briefs designed
 * through render's template path with the template Designer's tools, gated again from the stored files and its
 * designs measured against the reel's; a design off the reel's place, size or lines fails its case and says why.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TEMPLATE_CASES } from '../../src/design/template-cases';
import { templateMode } from '../../src/design/template-mode';
import { compareToReel, compareWide, TEMPLATE_TOLERANCES } from '../../src/design/template-run';

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-design-template-'));
  roots.push(root);
  return root;
};

describe('eval:design --template with the stand-ins', () => {
  it('designs every reel graphic through the template path and passes every case', async () => {
    const root = await scratch();
    const out = await scratch();
    const report = await templateMode({
      root,
      out,
      cases: [],
      frames: 'stand-in',
      live: null,
      label: () => 'stand-in',
      log: () => {},
    });
    expect(report.total).toBe(6);
    expect(report.cases.filter((entry) => !entry.pass).map((entry) => `${entry.id}: ${entry.why}`)).toEqual(
      [],
    );
    expect(report.passed).toBe(report.total);
    const twoAtOnce = report.cases.find((entry) => entry.id === 'two-at-once')!;
    expect(twoAtOnce.briefs).toHaveLength(2);
    const chat = report.cases.find((entry) => entry.id === 'chat-pair')!;
    expect(chat.checks).toHaveLength(2);
    // The 16:9 reel's pair, designed for 9:16: each keeps the reel's shape, by its aspect in pixels.
    const wide = report.cases.find((entry) => entry.id === 'chat-pair-wide')!;
    expect(wide.checks.map((check) => check.aspect)).toEqual([expect.any(Number), expect.any(Number)]);
    for (const check of wide.checks) expect(Math.abs(check.aspect! - 1)).toBeLessThan(0.05);
    // Both chat cases are held to the template Designer's own reel-match check too.
    expect([...chat.checks, ...wide.checks].map((check) => check.reelMatch)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    for (const brief of report.cases.flatMap((entry) => entry.briefs))
      expect(brief).toMatchObject({ designed: true, gatePassed: true, renders: 1 });
    const saved = JSON.parse(await readFile(join(out, 'design.json'), 'utf8')) as { tolerances: unknown };
    expect(saved.tolerances).toEqual({ ...TEMPLATE_TOLERANCES, lines: 'equal' });
    expect(await readdir(out)).toEqual(
      expect.arrayContaining(['design.json', 'design.md', ...TEMPLATE_CASES.map((c) => c.id)]),
    );
  });

  it('fails a design off the reel by place, by size or by lines, and says which', () => {
    const reel = { box: { x: 0.1, y: 0.3, width: 0.5, height: 0.06 }, lines: 1 };
    expect(compareToReel('a', reel, reel).why).toBeNull();
    expect(compareToReel('a', reel, { ...reel, box: { ...reel.box, x: 0.14 } }).why).toMatch(/middle/);
    expect(compareToReel('a', reel, { ...reel, box: { ...reel.box, x: 0.12 } }).why).toBeNull();
    expect(compareToReel('a', reel, { ...reel, box: { ...reel.box, x: 0.075, width: 0.55 } }).why).toBeNull();
    expect(compareToReel('a', reel, { ...reel, box: { ...reel.box, x: 0.0, width: 0.7 } }).why).toMatch(
      /wide/,
    );
    expect(compareToReel('a', reel, { ...reel, lines: 2 }).why).toMatch(/2 lines/);
    expect(compareToReel('a', reel, { box: null, lines: null }).why).toMatch(/draws nothing/);
  });

  it('holds a 16:9 reel’s design to its shape’s aspect, the edge it hangs from and the type floor', () => {
    // A slim pill in the 1080×608 reel's frame: 300 × 64 px, hanging from the left.
    const reel = { box: { x: 0.056, y: 0.25, width: 0.278, height: 0.105 }, lines: 1 };
    // On 1080×1920 the same aspect, grown: 540 × 115 px, its left edge and middle down where the reel's are.
    const design = { box: { x: 0.056, y: 0.2725, width: 0.5, height: 0.06 }, lines: 1 };
    expect(compareWide('a', reel, design, [], 608, 'left')).toMatchObject({ why: null, dx: 0, dy: 0 });
    // Squeezed narrow and tall, as a 1080 by 1920 mapping of the reel's shares makes it.
    const tall = { ...design, box: { ...design.box, y: 0.25, height: 0.105 } };
    expect(compareWide('a', reel, tall, [], 608, 'left').why).toMatch(/as wide for its height/);
    expect(compareWide('a', reel, design, ['typeFloor'], 608, 'left').why).toMatch(/type floor/);
    const moved = { ...design, box: { ...design.box, x: 0.1 } };
    expect(compareWide('a', reel, moved, [], 608, 'left').why).toMatch(/left edge/);
  });
});
