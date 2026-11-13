// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic GSAP ↔ Tone.js WebAudio & offline audio synthesis bridge for HyperFrames compositions.
 *
 * Allows Designer and Create workspace compositions to declare musical cues, UI clicks, risers, and synth
 * swells synced to composition timeline seconds (`atSeconds`), with:
 * 1. `TC_TONE_RUNTIME_JS` (`window.__tcToneBindScene`) for live `<hyperframes-player>` and headless DOM sync.
 * 2. `renderToneScenePcm` for deterministic faster-than-realtime offline synthesis into a 48 kHz mono PCM
 *    buffer (or RIFF WAV via `encodeToneSceneWav`) that mixes directly into the export audio track.
 */
import { z } from 'zod';
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import { createSeededRng } from './three-bridge';
import { escapeHtml } from '../compile/html';

export const TONE_INSTRUMENTS = ['synth', 'fm', 'membrane', 'noise', 'pluck'] as const;
export type ToneInstrument = (typeof TONE_INSTRUMENTS)[number];

export const toneCueSpecSchema = z.object({
  id: z.string().min(1).max(64),
  atSeconds: z.number().min(0),
  durationSeconds: z.number().min(0.02).max(15).default(0.35),
  instrument: z.enum(TONE_INSTRUMENTS).default('synth'),
  frequencyHz: z.number().min(20).max(8000).default(440),
  endFrequencyHz: z.number().min(20).max(8000).optional(),
  gainDb: z.number().min(-40).max(6).default(-12),
  label: z.string().max(64).optional(),
});

export const toneSceneSpecSchema = z.object({
  id: z.string().min(1).max(64),
  compositionId: z.string().min(1).max(64),
  seed: z.number().int().min(0).max(0xffffffff).default(0x544f4e45),
  bpm: z.number().min(40).max(240).default(120),
  durationSeconds: z.number().positive().max(180),
  cues: z.array(toneCueSpecSchema).min(1).max(128),
});

export type ToneCueSpec = z.infer<typeof toneCueSpecSchema>;
export type ToneSceneSpec = z.infer<typeof toneSceneSpecSchema>;

export function validateToneSceneSpec(input: unknown): Result<ToneSceneSpec> {
  const parsed = toneSceneSpecSchema.safeParse(input);
  if (!parsed.success) {
    return err(ValidationError({ field: 'toneSceneSpec' }, { detail: parsed.error.message.slice(0, 500) }));
  }
  const spec = parsed.data;
  for (const cue of spec.cues) {
    if (cue.atSeconds + cue.durationSeconds > spec.durationSeconds + 1e-6) {
      return err(
        ValidationError(
          { field: 'cues' },
          {
            detail: `cue "${cue.id}" [${cue.atSeconds}s + ${cue.durationSeconds}s] exceeds composition duration ${spec.durationSeconds}s`,
          },
        ),
      );
    }
  }
  return ok(spec);
}

/** Builds embedded JSON script markup for a HyperFrames composition's Tone.js scene. */
export function buildToneAudioScriptHtml(spec: ToneSceneSpec): string {
  const safeJson = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<script type="application/json" data-tc-tone-spec="${escapeHtml(spec.id)}">${safeJson}</script>`;
}

/**
 * Deterministically synthesizes all `cues` of a `ToneSceneSpec` into a 48 kHz mono `Float32Array` PCM buffer.
 */
export function renderToneScenePcm(spec: ToneSceneSpec, sampleRate = 48_000): Float32Array {
  const totalSamples = Math.max(1, Math.round(spec.durationSeconds * sampleRate));
  const out = new Float32Array(totalSamples);
  const rng = createSeededRng(spec.seed);

  for (const cue of spec.cues) {
    const startSample = Math.max(0, Math.round(cue.atSeconds * sampleRate));
    const cueSamples = Math.max(1, Math.round(cue.durationSeconds * sampleRate));
    const gain = Math.pow(10, cue.gainDb / 20);
    const f0 = cue.frequencyHz;
    const f1 = cue.endFrequencyHz ?? f0;
    let phase = 0;

    for (let i = 0; i < cueSamples && startSample + i < totalSamples; i++) {
      const u = i / cueSamples;
      const t = i / sampleRate;
      const freq = f0 * Math.pow(f1 / f0, u);
      phase += (2 * Math.PI * freq) / sampleRate;

      const attack = Math.min(1, t / 0.004);
      const release = Math.min(1, (1 - u) / 0.12);
      let sample = 0;
      switch (cue.instrument) {
        case 'synth':
          sample = Math.sin(phase) * attack * release;
          break;
        case 'fm':
          sample = Math.sin(phase + 1.8 * Math.exp(-u * 3) * Math.sin(phase * 2)) * attack * release;
          break;
        case 'membrane': {
          const dropPhase = phase + 2 * Math.PI * f0 * 1.5 * 0.025 * (1 - Math.exp(-t / 0.025));
          sample = Math.sin(dropPhase) * attack * Math.exp(-u * 4.5);
          break;
        }
        case 'pluck':
          sample = (0.7 * Math.sin(phase) + 0.3 * Math.sin(phase * 3)) * attack * Math.exp(-u * 6);
          break;
        case 'noise':
          sample = (rng() * 2 - 1) * Math.sin(Math.PI * u);
          break;
      }
      const idx = startSample + i;
      out[idx] = Math.max(-1, Math.min(1, (out[idx] ?? 0) + sample * gain));
    }
  }
  return out;
}

/**
 * In-page deterministic GSAP ↔ Tone.js runtime bridge:
 * Syncs cue state with `window.__timelines[spec.compositionId]` and `hf-seek` events so headless inspection
 * and live preview know which cues are active at any seek timestamp.
 */
export const TC_TONE_RUNTIME_JS = `(() => {
  window.__tcToneErrors = window.__tcToneErrors || [];
  window.__tcToneActiveCues = window.__tcToneActiveCues || {};
  window.__tcToneBindScene = function(spec, Tone) {
    if (!spec || !Array.isArray(spec.cues)) return null;
    const state = { time: 0, active: [] };
    const syncAt = function(seconds) {
      state.time = seconds;
      state.active = spec.cues
        .filter(function(c) { return seconds >= c.atSeconds && seconds <= c.atSeconds + c.durationSeconds; })
        .map(function(c) { return c.id; });
      window.__tcToneActiveCues[spec.id] = state.active;
    };
    if (window.gsap) {
      window.__timelines = window.__timelines || {};
      const tl = window.__timelines[spec.compositionId] || window.gsap.timeline({ paused: true });
      const proxy = { t: 0 };
      tl.to(proxy, {
        t: spec.durationSeconds,
        duration: spec.durationSeconds,
        ease: 'none',
        onUpdate: function() { syncAt(proxy.t); }
      }, 0);
      window.__timelines[spec.compositionId] = tl;
    }
    window.addEventListener('hf-seek', function(ev) {
      const sec = ev && ev.detail && typeof ev.detail.seconds === 'number' ? ev.detail.seconds : state.time;
      syncAt(sec);
    });
    syncAt(0);
    return { state: state, syncAt: syncAt, hasTone: Boolean(Tone) };
  };
})()`;
