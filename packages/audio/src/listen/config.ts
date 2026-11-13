// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 listening settings, ported from earshot at ff41f07 (plan/earshot-round-1.md). Each number names the upstream
 * place it comes from; the models' own settings (`preprocessor_config.json` in each component) are checked against
 * these when a model opens (models/configs.ts), so a different export fails loudly instead of drifting.
 *
 * `version` is part of the analysis cache key (EAR1-F7): bump it when an output changes for the same input.
 */
export const LISTEN_CONFIG = {
  version: 'ear1-1',
  /** earshot audio.SR: every source is decoded to 48 kHz mono, ffmpeg's `-ac 1` level (models/pcm.ts). */
  sampleRate: 48_000,
  clap: {
    /** laion/larger_clap_general's ClapFeatureExtractor (`truncation: rand_trunc`: the Slaney filters). */
    nFft: 1024,
    hop: 480,
    nMels: 64,
    fMin: 50,
    fMax: 14_000,
    /** `nb_max_samples`: 10 s at 48 kHz, repeat-padded up to it. */
    maxSamples: 480_000,
    /** 1 + maxSamples / hop, centred frames. */
    frames: 1001,
    /** earshot clap._prep: shorter input is zero-padded to 10 ms first. */
    minSamples: 480,
    /** HF spectrogram's `mel_floor` and power_to_db's `min_value`. */
    powerFloor: 1e-10,
    embedDim: 512,
  },
  /** earshot vocab.py: the CLAP windows describe, match and rank embed. */
  windows: { winS: 10, hopS: 5, maxWindows: 6 },
  ast: {
    /** earshot models/ast.py SR_AST and WIN_S; the input is resampled from 48 kHz (models/resample.ts). */
    sampleRate: 16_000,
    winS: 10.24,
    /** ast._forward: shorter windows are zero-padded to 0.1 s. */
    minSamples: 1600,
    /** ASTFeatureExtractor's NumPy Kaldi fbank (no torchaudio in upstream's environment). */
    frameLength: 400,
    frameShift: 160,
    fftLength: 512,
    nMels: 128,
    fMin: 20,
    maxFrames: 1024,
    mean: -4.2677393,
    std: 4.5689974,
    preemphasis: 0.97,
    /** float32 epsilon, Kaldi's log floor. */
    melFloor: 1.192092955078125e-7,
    labels: 527,
  },
  sessions: {
    /** Windows per model run. */
    batch: 4,
    /** A model nobody used for this long is released. */
    idleMs: 60_000,
  },
  calibration: {
    /** match.py VERDICTS: bands of z, not cumulative. */
    verdicts: { strong: 3.0, plausible: 2.5, weak: 2.0 },
    /** D23: a z this close to a band's start is `borderline`. */
    borderline: 0.15,
    /** vocab.calibrate: the population std over the vocabulary, plus this. */
    stdEpsilon: 1e-9,
    /** match.SILENT_DBFS: a sample peak under this makes the scores meaningless. */
    nearSilentDbfs: -70,
    /** vocab.UNVALIDATED: hints, never a verdict. */
    unvalidated: ['music_genre', 'music_mood', 'instruments', 'voice'],
    /** match.SKIP_CATS: left out of the closest descriptions. */
    skip: ['quality', 'production'],
    /**
     * D23 (orchestrator, 2026-11-06): vocabulary tags (describe, sections, event tags, realness) are scored against
     * the fp16-built bank on every machine, int8 too; free-text queries use the installed text model's bank.
     */
    tagBankDtype: 'fp16',
  },
  sections: {
    /** timeline.DETAIL['normal']: 3 s windows, hop 2 s, growing so a long file keeps at most 32. */
    winS: 3,
    hopS: 2,
    maxWindows: 32,
    astBudget: 3,
    mergeCos: 0.84,
    minLenS: 4,
    /** At most one section per this many seconds before the similarity rule stops merging. */
    perSeconds: 8,
    noveltyZ: 3,
    noveltyKernelS: 4,
  },
} as const;

export type ListenDtype = 'int8' | 'fp16';
