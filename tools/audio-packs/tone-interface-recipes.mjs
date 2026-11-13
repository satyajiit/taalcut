// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tone is injected by the browser-only authoring harness, never imported by app runtime code. */
export async function renderInterfaceSound(Tone, sound, authoring) {
  if (Tone.version !== authoring.version) throw new Error(`Expected Tone ${authoring.version}`);
  const seconds = sound.lengthMs / 1000;
  const nodes = [];
  try {
    const buffer = await Tone.Offline(
      () => {
        const filter = new Tone.Filter(authoring.filterHz, 'lowpass').toDestination();
        nodes.push(filter);
        sound.notes.forEach((note, index) => {
          const at = (index * seconds) / (sound.notes.length + 0.8);
          const synth = new Tone.Synth({
            oscillator: { type: authoring.oscillator },
            envelope: {
              attack: 0.004,
              decay: 0.018,
              sustain: 0.12,
              release: Math.min(0.2, seconds - at - 0.023),
              releaseCurve: 'exponential',
            },
            volume: -8,
          }).connect(filter);
          nodes.push(synth);
          synth.triggerAttackRelease(note, 0.018, at, 0.65);
        });
      },
      seconds,
      authoring.channels,
      authoring.sampleRate,
    );
    return Array.from(buffer.getChannelData(0));
  } finally {
    for (const node of nodes) node.dispose();
  }
}
