// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate over a workspace's files (HFW1 hf): the core report it gives (each check's status and what to fix), the
 * files' limits, the entry's text against its sha256, and assets loaded only by their own sha256.
 */
import { createHash } from 'node:crypto';
import { compositionGateSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { GATE_VERSION, gateComposition, type GateFile } from '../../src/workspace/gate/workspace-gate';
import { fixtureText } from './support';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const textFile = (path: string, text: string): GateFile => ({
  path,
  sha256: sha(text),
  bytes: Buffer.byteLength(text, 'utf8'),
  text,
});
const IMAGE = sha('made-up image bytes');
const asset = (sha256 = IMAGE): GateFile => ({ path: `assets/${sha256}`, sha256, bytes: 19 });

const status = (result: Awaited<ReturnType<typeof gateComposition>>) =>
  Object.fromEntries(result.gate.checks.map((check) => [check.id, check.status]));

/** The headline fixture with `#card` given a background image. */
const withBackground = async (url: string) =>
  (await fixtureText('headline.html')).replace(
    '#card {\n',
    `#card {\n          background-image: url(${url});\n          background-size: cover;\n`,
  );

describe('the workspace gate', () => {
  it('passes the headline fixture with a report every check passed, its variables and its length', async () => {
    const html = await fixtureText('headline.html');
    const result = await gateComposition({
      entry: 'index.html',
      files: [textFile('index.html', html)],
      now: 5,
    });
    expect(compositionGateSchema.parse(result.gate)).toEqual(result.gate);
    expect(result.gate).toMatchObject({
      version: GATE_VERSION,
      passed: true,
      checkedAt: 5,
      loweredTweens: 3,
    });
    expect(result.gate.hfLint.errors).toBe(0);
    expect(status(result)).toEqual({
      limits: 'pass',
      hfLint: 'pass',
      markup: 'pass',
      css: 'pass',
      lowering: 'pass',
      urls: 'pass',
    });
    expect(result.prepared?.doc.compositionId).toBe('headline');
    expect(result.variables.map((variable) => variable.name)).toEqual(['title', 'accent']);
    expect(result.durationSeconds).toBe(4);
  });

  it('refuses too many files, a bad path and an entry whose text is not its file, reading nothing further', async () => {
    const html = await fixtureText('headline.html');
    const many = Array.from({ length: 33 }, (_, index) => asset(sha(`image ${index}`)));
    const tooMany = await gateComposition({
      entry: 'index.html',
      files: [textFile('index.html', html), ...many],
    });
    expect(tooMany.findings.map((finding) => finding.code)).toEqual(['gate.files']);
    expect(status(tooMany)).toEqual({
      limits: 'fail',
      hfLint: 'skipped',
      markup: 'skipped',
      css: 'skipped',
      lowering: 'skipped',
      urls: 'skipped',
    });
    expect(tooMany.gate.passed).toBe(false);
    expect(tooMany.prepared).toBeUndefined();

    const badPath = await gateComposition({
      entry: '../index.html',
      files: [textFile('../index.html', html)],
    });
    expect(badPath.findings.map((finding) => finding.code)).toContain('gate.path');

    const stale = { ...textFile('index.html', html), sha256: sha('another text') };
    const mismatch = await gateComposition({ entry: 'index.html', files: [stale] });
    expect(mismatch.findings.map((finding) => finding.code)).toEqual(['gate.entry']);
    expect(mismatch.gate.checks[0]?.detail).toMatch(/entry/);
  });

  it('lets a style load an asset the files hold by its own sha256, and nothing else', async () => {
    const good = await withBackground(`"assets/${IMAGE}"`);
    const held = await gateComposition({
      entry: 'index.html',
      files: [textFile('index.html', good), asset()],
    });
    expect(held.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(held.gate.passed).toBe(true);

    const missing = await gateComposition({ entry: 'index.html', files: [textFile('index.html', good)] });
    expect(missing.findings.map((finding) => finding.code)).toEqual(['gate.asset']);
    expect(status(missing).urls).toBe('fail');
    expect(missing.prepared).toBeUndefined();

    const other = sha('other bytes');
    const misnamed = await gateComposition({
      entry: 'index.html',
      files: [textFile('index.html', good), { ...asset(), sha256: other }],
    });
    expect(misnamed.findings.map((finding) => finding.code)).toEqual(['gate.asset']);

    for (const url of [
      'https://cdn.jsdelivr.net/npm/x/a.png',
      'data:image/png;base64,AAAA',
      'assets/logo.png',
      `assets/${IMAGE}.png`,
    ]) {
      const refused = await gateComposition({
        entry: 'index.html',
        files: [textFile('index.html', await withBackground(url)), asset()],
      });
      expect(refused.findings.map((finding) => finding.code)).toContain('gate.css');
      expect(status(refused)).toMatchObject({ css: 'fail', urls: 'skipped' });
      expect(refused.findings.find((finding) => finding.code === 'gate.css')?.fixHint).toMatch(
        /assets\/<sha256>/,
      );
    }
  });

  it('reports every finding of the style and the script together, and still says the variables', async () => {
    const html = (await fixtureText('headline.html'))
      .replace('font-size: 120px;', 'font-size: 12vw;')
      .replace("ease: 'power3.out',", "ease: 'power3.out', repeat: -1,");
    const result = await gateComposition({ entry: 'index.html', files: [textFile('index.html', html)] });
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain('gate.css');
    expect(codes.some((code) => code.startsWith('lower.'))).toBe(true);
    expect(status(result)).toMatchObject({ css: 'fail', lowering: 'fail', urls: 'skipped' });
    expect(result.variables.map((variable) => variable.name)).toEqual(['title', 'accent']);
    for (const finding of result.findings) expect(finding.fixHint.length).toBeGreaterThan(10);
  });
});
