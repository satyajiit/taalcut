// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  buildToneAudioScriptHtml,
  mixFilterGraph,
  MIX_SAMPLE_RATE,
  renderToneScenePcm,
  TC_TONE_RUNTIME_JS,
  TAALCUT_DOCS,
  validateToneSceneSpec,
} from '../../src';

describe('Tone.js HyperFrames audio bridge and Pedalboard DSP mix filtergraph', () => {
  it('validates ToneSceneSpec cues and renders deterministic 48 kHz PCM audio', () => {
    const valid = validateToneSceneSpec({
      id: 'hero-audio',
      compositionId: 'comp-1',
      bpm: 128,
      durationSeconds: 2.0,
      cues: [
        {
          id: 'enter-pop',
          atSeconds: 0.1,
          durationSeconds: 0.25,
          instrument: 'membrane',
          frequencyHz: 180,
          endFrequencyHz: 55,
          gainDb: -6,
        },
        {
          id: 'peak-chime',
          atSeconds: 0.8,
          durationSeconds: 0.5,
          instrument: 'fm',
          frequencyHz: 523.25,
          gainDb: -10,
        },
      ],
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const pcmA = renderToneScenePcm(valid.value, 48_000);
    const pcmB = renderToneScenePcm(valid.value, 48_000);
    expect(pcmA.length).toBe(96_000);
    expect(pcmA).toEqual(pcmB);

    // Silence before 0.1 s (4800 samples), non-zero energy during the first cue
    expect(pcmA[100]).toBe(0);
    let energyInCue = 0;
    for (let i = 5000; i < 10_000; i++) energyInCue += Math.abs(pcmA[i] ?? 0);
    expect(energyInCue).toBeGreaterThan(10);

    const html = buildToneAudioScriptHtml(valid.value);
    expect(html).toContain('data-tc-tone-spec="hero-audio"');
    expect(TC_TONE_RUNTIME_JS).toContain('__tcToneBindScene');
    expect(TAALCUT_DOCS.some((d) => d.topic === 'taalcut/tone-audio')).toBe(true);
  });

  it('rejects ToneSceneSpec cues that exceed composition duration', () => {
    const invalid = validateToneSceneSpec({
      id: 'bad-audio',
      compositionId: 'comp-1',
      durationSeconds: 1.0,
      cues: [{ id: 'late', atSeconds: 0.8, durationSeconds: 0.5 }],
    });
    expect(invalid.ok).toBe(false);
  });

  it('keeps untrusted scene ids inside the script attribute and JSON payload', () => {
    const id = 'x"></script><img src=x onerror=alert(1)>';
    const valid = validateToneSceneSpec({
      id,
      compositionId: 'comp-1',
      durationSeconds: 1,
      cues: [{ id: 'click', atSeconds: 0 }],
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const html = buildToneAudioScriptHtml(valid.value);
    expect(html).toContain(
      'data-tc-tone-spec="x&quot;&gt;&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;"',
    );
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'));
    expect(JSON.parse(json).id).toBe(id);
  });

  it('embeds Pedalboard-style dspChain filters into MixSegment filtergraphs', () => {
    const graph = mixFilterGraph({
      sampleRate: MIX_SAMPLE_RATE,
      totalSamples: 48_000,
      silent: false,
      music: 'none',
      referenceAudio: false,
      segments: [
        {
          id: 'clip-1',
          kind: 'clip',
          path: '/tmp/clip1.wav',
          inSample: 0,
          startSample: 0,
          samples: 48_000,
          gainDb: 0,
          fadeInSamples: 0,
          fadeOutSamples: 0,
          tempo: 1,
          dspChain: 'voice-clarity',
        },
      ],
    });
    expect(graph).toContain('highpass=f=85:p=2');
    expect(graph).toContain('acompressor=threshold=-18dB:ratio=3:attack=15:release=120:makeup=2.5dB');
    expect(graph).toContain('alimiter=limit=-1.5dB:attack=5:release=50:level=false');
  });
});
