// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Declarative audio DSP effect chains (Pedalboard-style presets compiled to FFmpeg filtergraphs or WebAudio),
 * per-stem ITU-R BS.1770-4 loudness targets, beat-locked procedural SFX synthesis specs, and groove subdivisions.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const AUDIO_DSP_PRESETS = [
  'none',
  'voice-clarity',
  'voice-warm',
  'music-carve',
  'underwater-transition',
  'lofi-intro',
] as const;
export type AudioDspPresetId = (typeof AUDIO_DSP_PRESETS)[number];
export const audioDspPresetSchema = z.enum(AUDIO_DSP_PRESETS);

export const audioHighpassNodeSchema = z.object({
  kind: z.literal('highpass'),
  frequencyHz: z.number().min(20).max(2000).default(85),
  poles: z.union([z.literal(1), z.literal(2)]).default(2),
});

export const audioLowpassNodeSchema = z.object({
  kind: z.literal('lowpass'),
  frequencyHz: z.number().min(200).max(20_000).default(12_000),
  poles: z.union([z.literal(1), z.literal(2)]).default(2),
});

export const audioEqualizerNodeSchema = z.object({
  kind: z.literal('equalizer'),
  frequencyHz: z.number().min(20).max(20_000),
  q: z.number().min(0.1).max(18).default(1.2),
  gainDb: z.number().min(-24).max(24),
});

export const audioCompressorNodeSchema = z.object({
  kind: z.literal('compressor'),
  thresholdDb: z.number().min(-60).max(0).default(-18),
  ratio: z.number().min(1).max(20).default(3),
  attackMs: z.number().min(0.1).max(500).default(15),
  releaseMs: z.number().min(5).max(2000).default(120),
  makeupDb: z.number().min(0).max(24).default(2),
});

export const audioGateNodeSchema = z.object({
  kind: z.literal('gate'),
  thresholdDb: z.number().min(-70).max(-10).default(-42),
  ratio: z.number().min(1).max(20).default(2.5),
  attackMs: z.number().min(0.1).max(200).default(10),
  releaseMs: z.number().min(10).max(2000).default(150),
});

export const audioLimiterNodeSchema = z.object({
  kind: z.literal('limiter'),
  limitDb: z.number().min(-12).max(-0.1).default(-1.5),
  attackMs: z.number().min(0.1).max(50).default(5),
  releaseMs: z.number().min(5).max(500).default(50),
});

export const audioReverbNodeSchema = z.object({
  kind: z.literal('reverb'),
  roomMix: z.number().min(0.05).max(0.8).default(0.2),
  delayMs: z.int().min(15).max(250).default(65),
  decay: z.number().min(0.1).max(0.85).default(0.35),
});

export const audioDspNodeSchema = z.discriminatedUnion('kind', [
  audioHighpassNodeSchema,
  audioLowpassNodeSchema,
  audioEqualizerNodeSchema,
  audioCompressorNodeSchema,
  audioGateNodeSchema,
  audioLimiterNodeSchema,
  audioReverbNodeSchema,
]);
export type AudioDspNode = z.output<typeof audioDspNodeSchema>;

export const audioEffectChainSchema = z.object({
  preset: audioDspPresetSchema.default('none'),
  nodes: z.array(audioDspNodeSchema).max(12).default([]),
});
export type AudioEffectChain = z.output<typeof audioEffectChainSchema>;

/** Per-stem and master ITU-R BS.1770-4 loudness targets (LUFS & dBTP). */
export const STEM_LOUDNESS_ROLES = ['dialogue', 'music', 'effects', 'master'] as const;
export type StemLoudnessRole = (typeof STEM_LOUDNESS_ROLES)[number];
export const stemLoudnessRoleSchema = z.enum(STEM_LOUDNESS_ROLES);

export const STEM_LOUDNESS_TARGETS: Readonly<
  Record<StemLoudnessRole, { readonly targetLufs: number; readonly maxTruePeakDbtp: number; readonly maxLraLu: number }>
> = {
  dialogue: { targetLufs: -16, maxTruePeakDbtp: -1.5, maxLraLu: 10 },
  music: { targetLufs: -18, maxTruePeakDbtp: -1.5, maxLraLu: 14 },
  effects: { targetLufs: -18, maxTruePeakDbtp: -1.5, maxLraLu: 16 },
  master: { targetLufs: -14, maxTruePeakDbtp: -1.0, maxLraLu: 12 },
} as const;

export const stemLoudnessReportSchema = z.object({
  role: stemLoudnessRoleSchema,
  integratedLufs: z.number(),
  truePeakDbtp: z.number(),
  loudnessRangeLu: z.number().nonnegative(),
  momentaryMaxLufs: z.number(),
  shortTermMaxLufs: z.number(),
  targetLufs: z.number(),
  recommendedGainDb: z.number(),
  needsCompression: z.boolean(),
});
export type StemLoudnessReport = z.output<typeof stemLoudnessReportSchema>;

/** Tone.js-style procedural SFX & beat-locked stem synthesis categories. */
export const SYNTH_SFX_CATEGORIES = [
  'whoosh',
  'riser',
  'impact',
  'hit',
  'ui-click',
  'synth-swell',
  'sub-drop',
] as const;
export type SynthSfxCategory = (typeof SYNTH_SFX_CATEGORIES)[number];
export const synthSfxCategorySchema = z.enum(SYNTH_SFX_CATEGORIES);

export const synthSfxSpecSchema = z.object({
  category: synthSfxCategorySchema,
  durationMs: z.int().min(40).max(8000).default(800),
  bpm: z.number().min(40).max(240).optional(),
  pitchHz: z.number().min(28).max(4400).optional(),
  brightness: z.number().min(0).max(1).default(0.5),
  seed: z.int().min(1).max(1_000_000).default(101),
  targetLufs: z.number().min(-30).max(-6).default(-16),
});
export type SynthSfxSpec = z.output<typeof synthSfxSpecSchema>;

/** Groove & sub-beat snapping subdivisions. */
export const GROOVE_SUBDIVISIONS = ['downbeat', '1/1', '1/2', '1/4', '1/8'] as const;
export type GrooveSubdivision = (typeof GROOVE_SUBDIVISIONS)[number];
export const grooveSubdivisionSchema = z.enum(GROOVE_SUBDIVISIONS);
