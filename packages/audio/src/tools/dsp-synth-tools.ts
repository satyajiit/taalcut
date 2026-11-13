// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent tools for procedural Tone.js-style SFX synthesis (`sfx.synthesizeProcedural`), Pedalboard-style DSP
 * chain recommendation (`audio.recommendDspChain`), and musical sub-beat groove snapping (`audio.snapToGroove`).
 */
import {
  artifactRefSchema,
  audioDspPresetSchema,
  audioEffectChainSchema,
  computeFallbackEvent,
  defineTool,
  grooveSubdivisionSchema,
  NO_TOOL_RETRY,
  ok,
  selectBackend,
  STEM_LOUDNESS_ROLES,
  STEM_LOUDNESS_TARGETS,
  synthSfxSpecSchema,
  type AudioDspPresetId,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import { buildDspFilterChain } from '@taalcut/media';
import { z } from 'zod';
import { buildGrooveGrid, snapTimeToGroove } from '../beats/groove-grid';
import { synthesizeProceduralSfx } from '../synth/tone-synth';

export const synthesizeProceduralSfxOutputSchema = z.object({
  audio: artifactRefSchema.describe('Synthesized 48 kHz mono WAV artifact (audio/wav)'),
  category: z.string(),
  durationMs: z.int().positive(),
  peakMs: z.int().nonnegative(),
  integratedLufs: z.number(),
  truePeakDbtp: z.number(),
});

export function createSynthesizeSfxTool(
  deps: {
    readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  } = {},
) {
  let recordedFallback = false;
  return defineTool({
    name: 'sfx.synthesizeProcedural',
    version: '1.0.0',
    description:
      'Synthesizes a deterministic, BPM- and duration-locked procedural sound effect (whoosh, riser, impact, ' +
      'hit, ui-click, synth-swell, sub-drop) at 48 kHz using Tone.js-style filter sweeps and oscillators, ' +
      'using K-weighted loudness gain and reconstructed peak protection. Peak headroom can keep loudness ' +
      'below the requested target. Runs locally with zero cloud cost.',
    summary: 'Synthesizes a custom beat-locked procedural sound effect WAV artifact.',
    tags: ['sfx', 'synth', 'tone', 'riser', 'whoosh', 'impact', 'procedural', 'audio'],
    input: synthSfxSpecSchema,
    output: synthesizeProceduralSfxOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 15_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => JSON.stringify(input),
    run: async (input, ctx) => {
      const candidates = ['metal', 'webgpu', 'cuda', 'cpu'] as const;
      const choice = selectBackend(candidates, ['cpu'], {
        fallbackReason: 'no_accelerator',
        detail: 'Procedural oscillators and filter sweeps have no accelerated kernel in this build',
      });
      if (!choice.ok) return choice;
      if (choice.value.fallback && !recordedFallback) {
        recordedFallback = true;
        const event = computeFallbackEvent(
          'audio.synthesizeProceduralSfx',
          candidates,
          choice.value.fallback,
        );
        if (deps.onComputeFallback) deps.onComputeFallback(event);
        else console.warn('[audio] compute.fallback', event);
      }
      const result = synthesizeProceduralSfx(input);
      const stored = await ctx.artifacts.put({
        mediaType: 'audio/wav',
        data: new Uint8Array(result.wav),
        summary: `Procedural ${result.category} SFX (${result.durationMs} ms, peak at ${result.peakMs} ms, ${result.integratedLufs} LUFS).`,
      });
      if (!stored.ok) return stored;
      return ok({
        audio: stored.value,
        category: result.category,
        durationMs: result.durationMs,
        peakMs: result.peakMs,
        integratedLufs: result.integratedLufs,
        truePeakDbtp: result.truePeakDbtp,
      });
    },
  });
}

export const recommendDspChainInputSchema = z.object({
  role: z.enum(STEM_LOUDNESS_ROLES).default('dialogue'),
  integratedLufs: z.number().optional(),
  truePeakDbtp: z.number().optional(),
  loudnessRangeLu: z.number().nonnegative().optional(),
  preset: audioDspPresetSchema.optional(),
});

export const recommendDspChainOutputSchema = z.object({
  preset: audioDspPresetSchema,
  chain: audioEffectChainSchema,
  ffmpegFilter: z.string(),
  targetLufs: z.number(),
  recommendedGainDb: z.number(),
});

export function createRecommendDspChainTool() {
  return defineTool({
    name: 'audio.recommendDspChain',
    version: '1.0.0',
    description:
      'Recommends a Pedalboard-style studio DSP chain (high-pass, noise gate, EQ, compressor, limiter, reverb) ' +
      'and BS.1770-4 stem gain adjustment for dialogue, music, effects, or master tracks, returning both the ' +
      'structured AudioEffectChain and its compiled FFmpeg filtergraph.',
    summary: 'Recommends a studio DSP effect chain and stem loudness gain.',
    tags: ['dsp', 'pedalboard', 'eq', 'compressor', 'loudness', 'voice', 'mix'],
    input: recommendDspChainInputSchema,
    output: recommendDspChainOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => JSON.stringify(input),
    run: async (input) => {
      const target = STEM_LOUDNESS_TARGETS[input.role];
      const preset: AudioDspPresetId =
        input.preset ??
        (input.role === 'dialogue' ? 'voice-clarity' : input.role === 'music' ? 'music-carve' : 'none');
      const chain = { preset, nodes: [] };
      const ffmpegFilter = buildDspFilterChain(chain);
      const rawDelta = input.integratedLufs !== undefined ? target.targetLufs - input.integratedLufs : 0;
      const peakCap = input.truePeakDbtp !== undefined ? target.maxTruePeakDbtp - input.truePeakDbtp : 24;
      const recommendedGainDb =
        Math.round(Math.max(-24, Math.min(24, Math.min(rawDelta, peakCap))) * 100) / 100;
      return ok({
        preset,
        chain,
        ffmpegFilter,
        targetLufs: target.targetLufs,
        recommendedGainDb,
      });
    },
  });
}

export const snapToGrooveInputSchema = z.object({
  timesMs: z.array(z.number().nonnegative()).min(1).max(200),
  beatsMs: z.array(z.number().nonnegative()).min(1).max(2000),
  downbeats: z.array(z.int().nonnegative()).max(500).default([]),
  subdivision: grooveSubdivisionSchema.default('1/1'),
  swing: z.number().min(0.5).max(0.67).default(0.5),
  maxWindowMs: z.number().min(10).max(500).default(80),
});

export const snapToGrooveOutputSchema = z.object({
  subdivision: grooveSubdivisionSchema,
  snappedCount: z.int().nonnegative(),
  results: z.array(
    z.object({
      originalMs: z.number(),
      snappedMs: z.number(),
      deltaMs: z.number(),
      snapped: z.boolean(),
      kind: z.enum(['downbeat', 'beat', 'subbeat']).nullable(),
    }),
  ),
});

export function createSnapToGrooveTool() {
  return defineTool({
    name: 'audio.snapToGroove',
    version: '1.0.0',
    description:
      'Snaps candidate cut or animation timestamps (in ms) onto a musical beat or sub-beat groove grid ' +
      '(downbeat, 1/1, 1/2, 1/4, 1/8) with optional swing.',
    summary: 'Snaps timestamps onto a musical beat or sub-beat groove grid.',
    tags: ['beats', 'groove', 'snap', 'subdivision', 'rhythm', 'cuts'],
    input: snapToGrooveInputSchema,
    output: snapToGrooveOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => JSON.stringify(input),
    run: async (input) => {
      const groove = buildGrooveGrid(
        { beatsMs: input.beatsMs, downbeats: input.downbeats },
        input.subdivision,
        input.swing,
      );
      const results = input.timesMs.map((ms) => {
        const res = snapTimeToGroove(ms, groove, input.maxWindowMs);
        return {
          originalMs: res.originalMs,
          snappedMs: res.snappedMs,
          deltaMs: res.deltaMs,
          snapped: res.snapped,
          kind: res.point?.kind ?? null,
        };
      });
      return ok({
        subdivision: input.subdivision,
        snappedCount: results.filter((r) => r.snapped).length,
        results,
      });
    },
  });
}
