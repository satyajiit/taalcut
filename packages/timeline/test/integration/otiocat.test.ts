// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Feeds an export to OpenTimelineIO's own reader (`otiocat`) when
 * TAALCUT_OTIOCAT points at one: developer machines only. Nothing that ships
 * needs Python; CI runs the zod check in otio.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRates } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { serializeOtio, toOtio } from '../../src/interchange/otio/otio-writer';
import { buildTimeline } from '../fixtures/timeline';

const otiocat = process.env.TAALCUT_OTIOCAT;

describe.skipIf(!otiocat)('otiocat reads the export', () => {
  it('parses gaps, transitions, NTSC and 25 fps media, a still and an offline original', () => {
    const { timeline } = buildTimeline({
      rate: FrameRates.fps29_97,
      clips: [
        { frames: 30, mediaRate: FrameRates.fps25, sourceStart: 40 },
        { frames: 30, transition: ['dissolve', 4, 4] },
        { frames: 15, gap: true },
        { frames: 30, image: true },
        { frames: 45, ramp: [[0, 1], [30, 2]] },
      ],
      texts: [{ start: 0, frames: 30 }],
    });
    let index = 0;
    const exported = toOtio(
      timeline,
      (assetId) => ({ url: index++ === 1 ? null : `file:///tmp/${assetId}.mov`, name: `${assetId}.mov` }),
      { transitions: 'transition' },
    );
    if (!exported.ok) throw new Error(exported.error.detail);
    const directory = mkdtempSync(join(tmpdir(), 'taalcut-otio-'));
    try {
      const file = join(directory, 'timeline.otio');
      writeFileSync(file, serializeOtio(exported.value));
      const printed = execFileSync(otiocat as string, [file], { encoding: 'utf8' });
      expect(printed).toContain('"OTIO_SCHEMA": "Timeline.1"');
      expect(printed).toContain('"OTIO_SCHEMA": "Clip.2"');
      expect(printed).toContain('"OTIO_SCHEMA": "MissingReference.1"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
