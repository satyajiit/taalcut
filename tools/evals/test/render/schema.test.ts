// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { beatsMatch, cutFrames } from '../../src/render/check';
import { listCommittedRenderIds, writeRenderFixtures } from '../../src/render/fixtures';
import { durationFrames, parseRenderGolden, type RenderGolden } from '../../src/render/schema';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../goldens/render');

function loadAll(): RenderGolden[] {
  return listCommittedRenderIds(root).map((id) =>
    parseRenderGolden(JSON.parse(readFileSync(join(root, id, 'timeline.json'), 'utf8')) as unknown, id),
  );
}

describe('committed render goldens', () => {
  it('parses ten plans covering 15s, 30s, 60s and four caption languages', () => {
    const goldens = loadAll();
    expect(goldens).toHaveLength(10);
    const durations = new Set(goldens.map((golden) => durationFrames(golden)));
    expect(durations.has(450)).toBe(true);
    expect(durations.has(900)).toBe(true);
    expect(durations.has(1800)).toBe(true);
    const languages = new Set(goldens.flatMap((golden) => golden.captions.map((caption) => caption.language)));
    for (const language of ['en', 'hi', 'es', 'pt-BR'] as const) {
      expect(languages.has(language)).toBe(true);
    }
    expect(goldens.some((golden) => golden.captions.some((caption) => caption.text === 'नमस्ते'))).toBe(true);
    expect(goldens.some((golden) => golden.transition !== undefined)).toBe(true);
    expect(goldens.some((golden) => golden.overlays.length > 0)).toBe(true);
    for (const golden of goldens) {
      expect(golden.synthetic).toBe(true);
      expect(golden.note).toMatch(/synthetic plan/i);
      expect(golden.note).toMatch(/generated at test time/i);
      expect(golden.width).toBe(80);
      expect(golden.height).toBe(24);
      expect(golden.cellSize).toBe(2);
      expect(beatsMatch(cutFrames(golden), golden.beats).pass).toBe(true);
    }
  });

  it('fixtures copy the committed timelines and do not render them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-render-fixtures-'));
    try {
      const ids = writeRenderFixtures(dir, root);
      expect(ids).toHaveLength(10);
      for (const id of ids) {
        expect(readFileSync(join(dir, id, 'timeline.json'), 'utf8')).toBe(
          readFileSync(join(root, id, 'timeline.json'), 'utf8'),
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
