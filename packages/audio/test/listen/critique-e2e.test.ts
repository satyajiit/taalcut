// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1 critique end to end on the 10 fixture films with our own model passes per dtype: the AudioSet music and
 * speech windows (AST) and realness (CLAP), against upstream's fp32 `earshot critique`. Needs `TAALCUT_EAR1_MODELS`.
 * The music share, p_real, every scored status and the verdict are compared; the numbers go to the console.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { clips, cliRun, ffmpegMono, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import { critiqueSound } from '../../src/listen/critique/critique';
import { musicWindows } from '../../src/listen/critique/metrics-time';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { createAstTagger } from '../../src/listen/models/ast';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions, type ListenSessions } from '../../src/listen/models/sessions';
import { realnessOf } from '../../src/listen/realness/realness';
import { MODELS } from './models-helpers';

interface UpstreamCritique {
  readonly verdict: string;
  readonly score: number;
  readonly metrics: readonly { metric: string; value: number | null; status: string; weight: string }[];
  readonly events: Readonly<Record<string, readonly number[]>>;
}
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const DEVICES = { fp16: ['webgpu', 'cpu'], int8: ['cpu'] } as const;
const opened: ListenSessions[] = [];
const runner = createSpectrogramRunner();
afterAll(async () => {
  for (const sessions of opened) await sessions.release();
  await runner.release();
});

describe.skipIf(!MODELS).each(['fp16', 'int8'] as const)(
  '%s critique end to end against upstream',
  (dtype) => {
    it('gives the same verdicts and scored statuses on the 10 films', async () => {
      const sessions = createListenSessions({
        files: directoryListenFiles(MODELS ?? '', dtype),
        plan: async () => ({ devices: [...DEVICES[dtype]] }),
      });
      opened.push(sessions);
      const clap = createClapAudio(sessions);
      const ast = createAstTagger(sessions);
      const lines: string[] = [];
      let verdicts = 0;
      let statuses = 0;
      let rows = 0;
      let musicSame = 0;
      for (const id of clips('film').map((c) => c.id)) {
        const up = cliRun<UpstreamCritique>('critique', id);
        const clip = loadClip(id);
        const mono = ffmpegMono(clip);
        const music = await musicWindows(ast, mono);
        const realness = await realnessOf(mono, clap);
        if (!music.ok || !realness.ok) throw new Error(`${id}: a model pass failed`);
        const r = await critiqueSound({
          audio: { sampleRate: clip.sampleRate, channels: clip.channels },
          runner,
          picture: { cuts: up.events['visual'] ?? [], frameRate: { num: 30, den: 1 } },
          music: music.value,
          realness: realness.value,
        });
        const upMusic = up.metrics.find((m) => m.metric === 'music_frac')?.value;
        const upReal = up.metrics.find((m) => m.metric === 'p_real')?.value;
        if (r.film?.metrics.musicFrac === upMusic) musicSame += 1;
        if (r.verdict === up.verdict) verdicts += 1;
        for (const row of up.metrics) {
          if (row.weight === 'info') continue;
          rows += 1;
          const mine = r.rows.find((x) => x.id === camel(row.metric));
          if ((mine?.status === 'na' ? 'n.a.' : mine?.status) === row.status) statuses += 1;
          else lines.push(`${id} ${row.metric} ${row.value} ${row.status} → ${mine?.value} ${mine?.status}`);
        }
        lines.push(
          `${id}: ${up.verdict} ${up.score} → ${r.verdict} ${r.score}; music ${upMusic} → ${r.film?.metrics.musicFrac}; ` +
            `p_real ${upReal} → ${realness.value.pReal}`,
        );
      }
      console.warn(
        `[A1 critique ${dtype}] verdicts ${verdicts}/10, scored statuses ${statuses}/${rows}, music share ${musicSame}/10\n${lines.join('\n')}`,
      );
      expect(verdicts).toBe(10);
      expect(statuses / rows).toBeGreaterThanOrEqual(0.99);
    }, 900_000);
  },
);
