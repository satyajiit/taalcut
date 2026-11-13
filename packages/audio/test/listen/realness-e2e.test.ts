// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1 realness end to end: our CLAP audio encoder per dtype (fp16 on WebGPU, int8 on the CPU, as the machine fit
 * sends them) on every parity clip, against upstream's fp32 `earshot realness`. Needs `TAALCUT_EAR1_MODELS`. The
 * numbers per dtype (worst and 95th-percentile |Δp|, verdicts that differ, and whether each differing one sits
 * within REALNESS_BORDERLINE of a threshold) are written to the console for the SPEC.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cliRun, ffmpegMono, loadClip, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions, type ListenSessions } from '../../src/listen/models/sessions';
import { isRealnessBorderline, realnessOf } from '../../src/listen/realness/realness';
import { MODELS } from './models-helpers';
import type { UpstreamRealness } from './realness-helpers';

const DEVICES = { fp16: ['webgpu', 'cpu'], int8: ['cpu'] } as const;
/** The gates per dtype: the worst |Δp| and the share of verdicts that must agree; the rest must be borderline. */
const GATES = { fp16: { worst: 0.02, agree: 1 }, int8: { worst: 0.08, agree: 0.95 } } as const;
const opened: ListenSessions[] = [];
afterAll(async () => {
  for (const sessions of opened) await sessions.release();
});

describe.skipIf(!MODELS).each(['fp16', 'int8'] as const)(
  '%s realness end to end against upstream',
  (dtype) => {
    it(`p_real near upstream's, ≥ ${GATES[dtype].agree * 100}% of verdicts the same, the others borderline`, async () => {
      const sessions = createListenSessions({
        files: directoryListenFiles(MODELS ?? '', dtype),
        plan: async () => ({ devices: [...DEVICES[dtype]] }),
      });
      opened.push(sessions);
      const clap = createClapAudio(sessions);
      const deltas: number[] = [];
      const differ: string[] = [];
      let same = 0;
      let compared = 0;
      const started = performance.now();
      for (const clip of manifest().clips) {
        const up = cliRun<UpstreamRealness>('realness', clip.id);
        const r = await realnessOf(ffmpegMono(loadClip(clip.id)), clap);
        expect(r.ok, clip.id).toBe(true);
        if (!r.ok) continue;
        compared += 1;
        if (r.value.verdict === up.verdict) same += 1;
        else {
          const flagged = isRealnessBorderline(r.value);
          differ.push(
            `${clip.id} ${up.verdict}→${r.value.verdict} (${up.p_real}→${r.value.pReal}${flagged ? ', borderline' : ''})`,
          );
          expect(flagged, clip.id).toBe(true);
        }
        if (up.p_real !== null && r.value.pReal !== null) deltas.push(Math.abs(r.value.pReal - up.p_real));
      }
      const sorted = [...deltas].sort((a, b) => a - b);
      const worst = sorted[sorted.length - 1] ?? 0;
      const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
      console.warn(
        `[A1 realness ${dtype}] ${compared} clips in ${Math.round(performance.now() - started)} ms: |Δp| worst ${worst.toFixed(4)}, ` +
          `p95 ${p95.toFixed(4)}, mean ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(4)}; ` +
          `verdicts ${same}/${compared} the same${differ.length ? `; differ: ${differ.join('; ')}` : ''}`,
      );
      expect(compared).toBeGreaterThanOrEqual(40);
      expect(worst).toBeLessThanOrEqual(GATES[dtype].worst);
      expect(same / compared).toBeGreaterThanOrEqual(GATES[dtype].agree);
    }, 600_000);
  },
);
