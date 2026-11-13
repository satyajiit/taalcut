// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The critique as F7's analysis plugs it in (analysis/extensions.ts `SoundCritic`): the pass's decoded audio and
 * cuts, the analysis's realness, the AudioSet music windows when the models run (an AST that isn't installed
 * leaves them out: the critique is partial, as `--fast` is), against the launch films or the template reel
 * (`request.reference`). Core's SoundCritique out; null when the sound can't be critiqued (under 3 s, silent).
 */
import { RationalTime, err, ok } from '@taalcut/core';
import type { SoundCritic } from '../analysis/hooks';
import { ListenBadInput } from '../errors';
import { realnessFromSound } from '../realness/realness';
import { measurementsOf } from './audio-pass';
import { critiqueSound, toSoundCritique } from './critique';
import type { CritiqueCommands } from './fixes';
import { musicWindows, type MusicWindow } from './metrics-time';
import { launchProfile, profileFromListening } from './profile';

export interface SoundCriticOptions {
  /** Builds ready commands (a hit on a cut) for the fixes. */
  readonly commands?: CritiqueCommands;
  /**
   * The audio was decoded from AAC / MP3 / Opus: true peak is judged against 0 dBTP, as upstream judges a decoded
   * lossy file. Default true: the analysis critiques renders and exports, whose sound is AAC.
   */
  readonly lossy?: boolean;
}

/**
 * A model that can't run here leaves the music share unmeasured (a partial critique), as `--fast` does; with the
 * request's `optionalModels` (EAR1-R1) so does one that fails while running.
 */
const UNAVAILABLE = new Set(['audio.listen_model_missing', 'audio.listen_unavailable']);

export function createSoundCritic(options: SoundCriticOptions = {}): SoundCritic {
  return async (input) => {
    const { request, analysis } = input;
    if (request.profile === 'reference' && !request.reference) {
      return err(
        ListenBadInput(undefined, { detail: "a 'reference' critique needs the template's listening" }),
      );
    }
    const profile = request.reference ? profileFromListening(request.reference) : launchProfile();
    let music: MusicWindow[] | undefined;
    if (input.models && (await (input.mayLoad?.('ast') ?? true))) {
      const windows = await musicWindows(input.models.ast, input.source.samples, input.signal);
      if (windows.ok) music = windows.value;
      else if (windows.error.code === 'core.cancelled') return windows;
      else if (UNAVAILABLE.has(windows.error.code) || input.optionalModels)
        input.skipped?.('ast', windows.error);
      else return windows;
    }
    const tempo = analysis.measures?.tempo?.bpm ?? null;
    const result = await critiqueSound({
      audio: input.audio,
      runner: input.spectrograms,
      picture: {
        cuts: input.cuts.map((c) => RationalTime.toSeconds(c)),
        ...(input.frameRate ? { frameRate: input.frameRate } : {}),
      },
      profile,
      profileKind: request.profile,
      lossy: options.lossy ?? true,
      ...(music ? { music } : {}),
      realness: analysis.realness ? realnessFromSound(analysis.realness) : null,
      // The analysis's own measurements and cut sync: measured once.
      ...(analysis.measures ? { meas: measurementsOf(analysis.measures) } : {}),
      ...(analysis.cutSync ? { cutSync: analysis.cutSync } : {}),
      beats: input.beats.map((b) => RationalTime.toSeconds(b)),
      tempo,
      ...(options.commands ? { commands: options.commands } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return ok(toSoundCritique(result));
  };
}
