// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTENT_BAR, scoreIntentSheet } from '../src/intents/score';
import { intentRows, sheetCsv } from '../src/intents/sheet';

function golden(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'reel-a.json'),
    `${JSON.stringify({
      reelId: 'reel-a',
      synthetic: true,
      note: 'Synthetic reel for the intent sheet.',
      source: { label: 'reel-a', durationFrames: 60 },
      frameRate: { numerator: 30, denominator: 1 },
      cuts: [30],
      beats: [],
      slots: [
        { id: 'hook', startFrame: 0, endFrame: 30, intent: 'hook' },
        { id: 'body', startFrame: 30, endFrame: 60, intent: 'show the step' },
      ],
      overlays: [],
      transitions: [],
      audio: { type: 'speech' },
      languages: ['en'],
    })}\n`,
  );
}

describe('intent sheet', () => {
  it('writes an empty usable column and scores yes or no', () => {
    const root = join(tmpdir(), `taalcut-intents-${Date.now()}`);
    const goldenDir = join(root, 'golden');
    const predictions = join(root, 'predictions');
    golden(goldenDir);
    mkdirSync(predictions, { recursive: true });
    writeFileSync(
      join(predictions, 'reel-a.json'),
      `${JSON.stringify({
        reelId: 'reel-a',
        synthetic: true,
        slots: [
          { id: 'hook', shotType: 'wide', motion: 'pan', frameFile: 'reel-a-hook.jpg' },
          { id: 'body', shotType: 'close', motion: 'static', frameFile: 'reel-a-body.jpg' },
        ],
      })}\n`,
    );
    const csv = sheetCsv(intentRows(goldenDir, predictions));
    expect(csv.split('\n')[0]).toBe(
      'reel,slot,startFrame,endFrame,frameFile,intent,shotType,motion,usable,synthetic',
    );
    expect(csv).toContain('reel-a,hook,0,30,reel-a-hook.jpg,hook,wide,pan,,true');
    const rated = csv.replace(',,true', ',yes,true').replace(',,true', ',no,true');
    const score = scoreIntentSheet(rated);
    expect(score.usable).toBe(1);
    expect(score.rows).toBe(2);
    expect(score.share).toBe(0.5);
    expect(score.pass).toBe(false);
    expect(score.envelope.claimed).toBe(false);
    expect(INTENT_BAR).toBe(0.8);
    expect(() => scoreIntentSheet(csv)).toThrow(/usable/);
  });

  it('passes at exactly 80% yes on real rows', () => {
    const header = 'reel,slot,usable,synthetic';
    const body = ['a,1,yes,false', 'a,2,yes,false', 'a,3,yes,false', 'a,4,yes,false', 'b,1,no,false'];
    const score = scoreIntentSheet([header, ...body].join('\n'));
    expect(score.share).toBe(0.8);
    expect(score.pass).toBe(true);
    expect(score.envelope.claimed).toBe(true);
    expect(score.perReel).toHaveLength(2);
  });
});
