// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V5: the FCPXML export validated with `xmllint --dtdvalid` against Apple's FCPXMLv1_14.dtd, taken from
 * Final Cut Pro.app or from TAALCUT_FCPXML_DTD. Apple doesn't publish the 1.14 DTD and its copyright header
 * keeps it out of the repo (a PO decision), so this runs on a developer Mac that has it; CI runs the structural
 * checks in interchange/fcpxml.test.ts. DTD-clean is necessary, not sufficient: the manual Final Cut check
 * in the SPEC is the rest.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRates } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { writeFcpxml } from '../../src/interchange/fcpxml/fcpxml-exporter';
import { originals, thirtyClipTimeline } from '../fixtures/interchange';

const IN_FINAL_CUT =
  '/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_14.dtd';
const dtd = process.env.TAALCUT_FCPXML_DTD ?? (existsSync(IN_FINAL_CUT) ? IN_FINAL_CUT : undefined);

describe.skipIf(!dtd)('FCPXML against the 1.14 DTD', () => {
  it.each([
    ['30', FrameRates.fps30],
    ['29.97', FrameRates.fps29_97],
  ])('the 30-clip fixture on a %s fps canvas is valid', (_label, rate) => {
    const timeline = thirtyClipTimeline(rate);
    const directory = mkdtempSync(join(tmpdir(), 'taalcut-fcpxml-'));
    try {
      const file = join(directory, 'timeline.fcpxml');
      writeFileSync(file, writeFcpxml(timeline, { media: originals(timeline), pathStyle: 'fileUrl' }));
      const output = execFileSync('xmllint', ['--noout', '--dtdvalid', dtd as string, file], {
        encoding: 'utf8',
      });
      expect(output).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
