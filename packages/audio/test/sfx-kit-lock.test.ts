// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D3's acceptance: for all four presets, the lock Taalcut makes (every take from the installed bank, measured
 * in TypeScript from its decoded samples) has upstream's kit.lock.json onset, peak and end within ±1 ms, the same
 * seeds (re-rolls included), the same files, and every take passes the audit. Skipped where the bank hasn't been
 * built or FFmpeg is absent.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { kit as fixtureKit } from '../../../tools/earshot-parity/fixtures.mjs';
import { createSpectrogramRunner } from '../src/listen/dsp/spectrogram-graph';
import { lockKit } from '../src/sfx/kits/lock';
import { KIT_PRESETS, kitPreset } from '../src/sfx/kits/presets';
import { parseKit } from '../src/sfx/kits/schema';
import { testMedia } from './helpers/ffmpeg';
import { HAS_BANK, installedBank } from './sfx-bank-helpers';

interface UpstreamTake {
  file: string;
  seed: number;
  onset_s: number;
  peak_s: number;
  end_s: number;
  dur_s: number;
  lufs_m_max: number;
  checks: string[];
  l50_lufs?: number;
  corr?: number;
}
type UpstreamLock = { roles: Record<string, { takes: UpstreamTake[] } | null> };

const found = await testMedia('sfx kit lock');
const runner = createSpectrogramRunner();
afterAll(() => runner.release());

describe.skipIf(!HAS_BANK || !found.ctx)('kit locks against upstream (EAR1-D3)', () => {
  it.each(KIT_PRESETS)(
    '%s: onset, peak and end within ±1 ms of kit.lock.json',
    { timeout: 300_000 },
    async (name) => {
      const media = found.ctx;
      if (!media) return;
      const bank = await installedBank();
      const kit = parseKit(kitPreset(name), bank);
      if (!kit.ok) throw new Error(kit.error.detail);
      const made = await lockKit({ bank, media, runner }, kit.value);
      if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
      const upstream = (fixtureKit(name) as unknown as { lock: UpstreamLock }).lock;
      let worst = 0;
      let worstLufs = 0;
      let takes = 0;
      for (const [role, theirs] of Object.entries(upstream.roles)) {
        const ours = made.value.lock.roles[role];
        if (!theirs) {
          expect(ours, role).toBeNull();
          continue;
        }
        expect(
          ours?.takes.map((t) => [t.file, t.seed, t.source]),
          role,
        ).toEqual(theirs.takes.map((t) => [t.file, t.seed, 'bank']));
        theirs.takes.forEach((t, i) => {
          const o = ours?.takes[i];
          if (!o) return;
          for (const [a, b] of [
            [o.onset_s, t.onset_s],
            [o.peak_s, t.peak_s],
            [o.end_s, t.end_s],
          ] as const)
            worst = Math.max(worst, Math.abs(a - b) * 1000);
          expect(o.dur_s, t.file).toBeCloseTo(t.dur_s, 3);
          worstLufs = Math.max(worstLufs, Math.abs(o.lufs_m_max - t.lufs_m_max));
          expect(o.checks, t.file).toEqual(t.checks);
          if (t.l50_lufs !== undefined)
            expect(Math.abs((o.l50_lufs ?? 0) - t.l50_lufs), t.file).toBeLessThan(0.05);
          if (t.corr !== undefined) expect(Math.abs((o.corr ?? 0) - t.corr), t.file).toBeLessThan(0.002);
          takes++;
        });
      }
      console.warn(
        `kit ${name}: ${takes} takes, worst ${worst.toFixed(2)} ms, worst loudness ${worstLufs.toFixed(3)} LU`,
      );
      expect(worst).toBeLessThanOrEqual(1);
      expect(worstLufs).toBeLessThan(0.05);
    },
  );
});
