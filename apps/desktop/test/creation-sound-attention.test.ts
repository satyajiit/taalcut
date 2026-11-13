// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A4: a creation's export is critiqued against the launch films (render QA's soundCritique, on what audio's
 * listen service hears in the exported AAC), and a silent seam between its scenes leaves the creation needing
 * attention with the seam's time, where a film without one finishes. The export itself is a stand-in record whose
 * QA report is built from the real hearing; creation-export.test runs the whole render.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineCommand,
  idSchema,
  newId,
  ok,
  RationalTime,
  RENDER_COMMANDS,
  RenderStoreToken,
  type QaReport,
  type RenderRecord,
  type RenderStore,
} from '@taalcut/core';
import { createListenService } from '@taalcut/audio';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { soundCritiqueCheck } from '@taalcut/render';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { creationMedia } from '../src/utility/creation/production-media';
import { creationSoundNotes } from '../src/utility/creation/sound-attention';
import { approvedFilm, creationWorld } from './helpers/creation';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('creation sound attention');
const root = mkdtempSync(join(tmpdir(), 'taalcut-creation-sound-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SR = 48_000;
const SEAM = { start: 6, end: 8.5 };

/** Two scenes of a pulsing pad and a beat, with or without 2.5 s of silence at the seam between them. */
function film(seconds: number, seam: boolean): Float32Array {
  const out = new Float32Array(seconds * SR);
  let seed = 3;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    if (seam && t >= SEAM.start && t < SEAM.end) continue;
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const beat = t % 0.5;
    const hit = beat < 0.06 ? 0.3 * Math.exp(-beat * 50) * (seed / 1_073_741_824 - 1) : 0;
    out[i] = 0.12 * Math.sin(2 * Math.PI * 220 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t)) + hit;
  }
  return out;
}

async function exported(media: MediaContext, name: string, mono: Float32Array): Promise<string> {
  const data = Buffer.alloc(mono.length * 4);
  mono.forEach((v, i) => data.writeFloatLE(v, i * 4));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const wav = join(root, `${name}.wav`);
  writeFileSync(wav, Buffer.concat([header, data]));
  const out = join(root, `${name}.mp4`);
  const encoded = await runFfmpeg(media, ['-y', '-i', wav, '-ac', '2', '-c:a', 'aac', '-b:a', '192k', out]);
  if (!encoded.ok) throw new Error(encoded.error.detail ?? encoded.error.code);
  return out;
}

describe.skipIf(!resolved.ok)('a creation’s export critiqued against the launch films (EAR1-A4)', () => {
  const media = (): MediaContext => ({ binaries: resolved.ok ? resolved.value : (undefined as never) });

  /** The export's QA report as render's soundCritique makes it from the hearing. */
  async function qaReport(seam: boolean): Promise<QaReport> {
    const service = createListenService({ media: async () => ok(media()) });
    try {
      const file = await exported(media(), seam ? 'seam' : 'whole', film(16, seam));
      const heard = await service.analyse({
        path: file,
        want: { measures: true, events: true, audit: true },
        cuts: [RationalTime.fromSeconds(SEAM.end, { num: 60, den: 1 })],
        frameRate: { num: 60, den: 1 },
        critique: { profile: 'launch' },
        install: false,
        optionalModels: true,
      });
      if (!heard.ok) throw new Error(heard.error.code);
      return {
        version: 1,
        renderId: newId<'Render'>(),
        round: 1,
        verdict: 'passedWithWarnings',
        presetId: 'landscape',
        checks: [soundCritiqueCheck({ critique: heard.value.critique, fps: 60 })],
        overrides: [],
        createdAt: 1,
      };
    } finally {
      await service.release();
    }
  }

  async function finalizeWith(report: QaReport) {
    const world = creationWorld();
    const filmRow = await approvedFilm(world);
    const renderId = newId<'Render'>();
    world.bus.register(
      defineCommand({
        name: RENDER_COMMANDS.export,
        payload: z.object({ projectId: idSchema<'Project'>() }),
        sideEffect: 'write',
        handle: async () => ok({ result: { renderId } }),
      }),
    );
    const store = {
      get: async () =>
        ok({ id: renderId, status: 'ready', qaReport: report, error: null } as unknown as RenderRecord),
    } as unknown as RenderStore;
    world.container.value(RenderStoreToken, store);
    return creationMedia(world.container).finalize(filmRow.timeline.id, new AbortController().signal);
  }

  it(
    'leaves a film with a silent seam needing attention, with the seam’s time',
    { timeout: 120_000 },
    async () => {
      const report = await qaReport(true);
      const notes = creationSoundNotes(report, 'Launch');
      expect(notes.length).toBeGreaterThan(0);
      const at = /a silent gap at 0:(\d\d\.\d\d)/.exec(notes.join(' '));
      expect(at, notes.join(' | ')).not.toBeNull();
      expect(Math.abs(Number(at?.[1]) - SEAM.start)).toBeLessThanOrEqual(0.1);
      const result = await finalizeWith(report);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.detail).toMatch(/needs attention: a silent gap at 0:0\d\.\d\d in /);
    },
  );

  it('finishes a film that sounds from start to end', { timeout: 120_000 }, async () => {
    const report = await qaReport(false);
    expect(creationSoundNotes(report, 'Launch')).toEqual([]);
    expect((await finalizeWith(report)).ok).toBe(true);
  });
});
