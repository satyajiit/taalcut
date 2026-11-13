// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The refusal fixtures (HFW1 hf): the headline with one thing the gate must refuse (the network, eval, the clock,
 * an endless repeat, a script, stylesheet or picture from a CDN), each refused with its own code and a fix hint.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gateComposition } from '../../src/workspace/gate/workspace-gate';
import { fixtureText } from './support';

const REFUSALS = [
  ['fetch', 'lower.forbidden'],
  ['eval', 'lower.forbidden'],
  ['date-now', 'lower.forbidden'],
  ['infinite-repeat', 'lower.repeat'],
  ['script-src', 'gate.scriptSrc'],
  ['jsdelivr-style', 'gate.link'],
  ['css-url', 'gate.css'],
  ['img-url', 'gate.markup'],
] as const;

describe('the refusal fixtures', () => {
  it.each(REFUSALS)('%s is refused with %s and a hint', async (name, code) => {
    const text = await fixtureText(`refusals/${name}.html`);
    const file = {
      path: 'index.html',
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
      text,
    };
    const result = await gateComposition({ entry: 'index.html', files: [file] });
    expect(result.gate.passed).toBe(false);
    expect(result.prepared).toBeUndefined();
    expect(result.findings.map((finding) => finding.code)).toContain(code);
    for (const finding of result.findings) expect(finding.fixHint.length).toBeGreaterThan(10);
  });
});
