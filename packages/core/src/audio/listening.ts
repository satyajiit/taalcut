// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 (plan/earshot-round-1.md): what Taalcut hears in a sound, as plain data that crosses IPC and goes into
 * templates. @taalcut/audio's listen/ (earshot's listening layer, ported) writes it: calibrated tags (CLAP), AudioSet
 * labels (AST), measurements, the event timeline and its sections. What is judged from them (cut sync, the audit,
 * the critique, realness) is in listening-report.ts.
 *
 * Positions in the media (an event's time, a section's bounds, a duration) are RationalTime. Offsets and lengths
 * (`offsetMs`, `lengthMs`) and levels are measurements, like a QA check's measured value.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';

const time = rationalTimeSchema;
const unit = z.number().min(0).max(1);
/** A level re full scale. earshot floors silence at 1e-12 (−240 dB), so digital silence is finite. */
const dbfs = z.number().min(-240).max(40);
const lufs = z.number().min(-120).max(10);
/** A signed offset against a cut or a beat, in milliseconds. */
const offsetMs = z.number().min(-60_000).max(60_000);

/**
 * How well a sound fits a description: a calibrated z (the bias-removed CLAP score, standardised over the
 * vocabulary for the same sound) in bands. Strong from z 3.0, plausible from 2.5, weak from 2.0, else no match.
 */
export const LISTEN_VERDICTS = ['strong', 'plausible', 'weak', 'no_match'] as const;
export type ListenVerdict = (typeof LISTEN_VERDICTS)[number];
/** Where each verdict starts (earshot match.py VERDICTS); under `weak`, no match. */
export const LISTEN_VERDICT_Z = { strong: 3.0, plausible: 2.5, weak: 2.0 } as const;
/** D23: a z this close to a verdict's start is `borderline`, so a quantised model's drift doesn't flip it unseen. */
export const LISTEN_BORDERLINE_Z = 0.15;

/** The vocabulary's categories (earshot data/vocab.json, 322 terms, vendored in third_party/earshot). */
export const SOUND_TAG_CATEGORIES = [
  'transitions',
  'impacts',
  'ui',
  'keyboard',
  'foley',
  'water',
  'nature',
  'chimes',
  'ambience',
  'everyday',
  'music_genre',
  'music_mood',
  'instruments',
  'voice',
  'quality',
  'production',
] as const;
export type SoundTagCategory = (typeof SOUND_TAG_CATEGORIES)[number];

/**
 * Categories earshot never validated (vocab.py UNVALIDATED): their tags are hints, worded as hints, and never get
 * a verdict. Genre and mood are guesses; so are instruments and voice.
 */
export const HINT_CATEGORIES = [
  'music_genre',
  'music_mood',
  'instruments',
  'voice',
] as const satisfies readonly SoundTagCategory[];
export type HintCategory = (typeof HINT_CATEGORIES)[number];
export const isHintCategory = (category: SoundTagCategory): category is HintCategory =>
  (HINT_CATEGORIES as readonly string[]).includes(category);

/** One description scored against a sound: a vocabulary term, or the person's own words matched to it. */
export const soundTagSchema = z
  .object({
    /** The vocabulary term ('a fast air whoosh') or the query as asked. Plain text, never markup. */
    term: z.string().min(1).max(200),
    /** The term's category; for free text, the category of its nearest vocabulary term. */
    category: z.enum(SOUND_TAG_CATEGORIES),
    /** The raw CLAP cosine of the sound and the text. */
    cosine: z.number().min(-1).max(1),
    /** The calibrated z (shown floored to 0.1). */
    z: z.number().min(-100).max(100),
    /** Null for a hint. */
    verdict: z.enum(LISTEN_VERDICTS).nullable(),
    /** A hint category's tag (or one heard inside a busy mix): a hint, never a fact. */
    hint: z.boolean(),
    /** D23: z within LISTEN_BORDERLINE_Z of a verdict's start. */
    borderline: z.boolean(),
    /** The softmax against the alternatives it was matched with (earshot's p_vs_alts); absent without any. */
    pVsAlts: unit.optional(),
  })
  .superRefine((tag, ctx) => {
    if (isHintCategory(tag.category) && !tag.hint)
      ctx.addIssue({ code: 'custom', message: 'A hint category’s tag is a hint', path: ['hint'] });
    if (tag.hint && tag.verdict !== null)
      ctx.addIssue({ code: 'custom', message: 'A hint has no verdict', path: ['verdict'] });
  });
export type SoundTag = z.output<typeof soundTagSchema>;

/** An AudioSet label AST gave the sound. The label names are the ontology's (CC-BY-4.0), shown as they are. */
export const audioSetLabelSchema = z.object({
  label: z.string().min(1).max(120),
  /** AST's sigmoid probability. */
  score: unit,
});
export type AudioSetLabel = z.output<typeof audioSetLabelSchema>;

/** The model checkpoints a listening came from, so a stored one can be told apart from a newer model's. */
export const LISTEN_DTYPES = ['fp32', 'fp16', 'int8'] as const;
export type ListenDtype = (typeof LISTEN_DTYPES)[number];
export const listenModelSchema = z.object({
  /** CLAP's checkpoint, e.g. 'laion/larger_clap_general@16c8cc3'. */
  clap: z.string().min(1).max(120),
  /** AST's checkpoint; null when no AST pass ran. */
  ast: z.string().min(1).max(120).nullable(),
  dtype: z.enum(LISTEN_DTYPES),
  /** The analysis settings' version (audio's listen cache key); absent before it had one. */
  configVersion: z.string().min(1).max(64).optional(),
});
export type ListenModel = z.output<typeof listenModelSchema>;

/** The spectrum bands earshot measures (features.py BANDS, without 'top'). */
export const SOUND_BANDS = ['sub', 'low', 'lowmid', 'mid', 'presence', 'air'] as const;
export type SoundBand = (typeof SOUND_BANDS)[number];
/** Each band's share of the whole spectrum in dB (≤ 0): sub 20–60 Hz, low –250, lowmid –1k, mid –4k, presence –8k, air –16k. */
const bandShare = z.number().min(-130).max(0);
export const soundBandSharesSchema = z.object({
  sub: bandShare,
  low: bandShare,
  lowmid: bandShare,
  mid: bandShare,
  presence: bandShare,
  air: bandShare,
});
export type SoundBandShares = z.output<typeof soundBandSharesSchema>;

/** How clearly a beat grid pulses (earshot timeline music_grid). */
export const PULSE_CONFIDENCES = ['clear', 'weak', 'none'] as const;
export type PulseConfidence = (typeof PULSE_CONFIDENCES)[number];
export const soundTempoSchema = z.object({
  bpm: z.number().positive().max(400),
  /** The double tempo when it pulses at least half as clearly: the felt tempo may be either. */
  alt: z.number().positive().max(400).nullable(),
  /** The normalised autocorrelation at the beat period. */
  clarity: z.number().min(-1).max(1),
  /** Clear from clarity 0.30 with an interval CV under 0.1; weak from 0.15. */
  confidence: z.enum(PULSE_CONFIDENCES),
});
export type SoundTempo = z.output<typeof soundTempoSchema>;

/** Pitch classes as earshot names them (features.py NOTE). */
export const PITCH_CLASSES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type PitchClass = (typeof PITCH_CLASSES)[number];
export const KEY_MODES = ['major', 'minor'] as const;
export type KeyMode = (typeof KEY_MODES)[number];
export const soundKeySchema = z.object({
  tonic: z.enum(PITCH_CLASSES),
  mode: z.enum(KEY_MODES),
  /** The chroma's correlation with the key's profile (Krumhansl–Kessler). */
  confidence: z.number().min(-1).max(1),
});
export type SoundKey = z.output<typeof soundKeySchema>;

/** A sound under this sample peak is near silence: its tags and verdicts would be meaningless, so none are made. */
export const NEAR_SILENT_DBFS = -70;

/** Objective measurements of a sound (earshot features.measure), shared by every listening. */
export const soundMeasuresSchema = z.object({
  duration: time,
  /** Integrated loudness (BS.1770); null under 0.4 s or when every block is gated out. */
  lufs: lufs.nullable(),
  truePeakDbtp: dbfs,
  peakDbfs: dbfs,
  /** Loudness range (EBU 3342); null under 6 s. */
  lraLu: z.number().min(0).max(100).nullable(),
  /** The loudest 3 s (short-term maximum) above the integrated loudness; null under 3 s. */
  crestLu: z.number().min(-60).max(130).nullable(),
  /** The 10th percentile of 20 ms RMS frames. */
  noiseFloorDbfs: dbfs,
  /** Sample peak under NEAR_SILENT_DBFS. */
  nearSilent: z.boolean(),
  /** The highest third-octave band within 60 dB of the loudest; null when too short to tell. */
  bandwidthHz: z.number().nonnegative().max(48_000).nullable(),
  /** Brightness: the median spectral centroid of the frames within 30 dB of the loudest. */
  brightnessHz: z.number().nonnegative().max(48_000).nullable(),
  bands: soundBandSharesSchema.nullable(),
  /** Side level against mid level; null for mono or silent sound. */
  sideToMidDb: z.number().min(-240).max(240).nullable(),
  /** The beat grid's tempo; null without a pulse, absent when not measured (not music, or too short). */
  tempo: soundTempoSchema.nullable().optional(),
  /** The musical key; null when none stands out, absent when not measured. */
  key: soundKeySchema.nullable().optional(),
});
export type SoundMeasures = z.output<typeof soundMeasuresSchema>;

/** An onset (a hit) or a build-up timed at its peak (a swell: whoosh, riser). */
export const SOUND_EVENT_SHAPES = ['hit', 'swell'] as const;
export type SoundEventShape = (typeof SOUND_EVENT_SHAPES)[number];
/** The envelope it stood out in: the full signal, its lows (< 200 Hz) or its highs (> 2 kHz). */
export const SOUND_EVENT_BANDS = ['full', 'low', 'high'] as const;
export type SoundEventBand = (typeof SOUND_EVENT_BANDS)[number];
/**
 * What an event is, by its top tag in earshot's compact event vocabulary (timeline EVENT_VOCAB, a few caption-like
 * phrases each). Event tags are ranked within that vocabulary, uncalibrated, so they carry no verdict.
 */
export const SOUND_EVENT_KINDS = [
  'whoosh',
  'riser',
  'hit',
  'key',
  'ui',
  'step',
  'foley',
  'note',
  'drum',
  'voice',
] as const;
export type SoundEventKind = (typeof SOUND_EVENT_KINDS)[number];

export const soundEventTagSchema = z.object({
  /** The event phrase ('a fast air whoosh'). */
  term: z.string().min(1).max(120),
  kind: z.enum(SOUND_EVENT_KINDS),
  /** z within the event vocabulary for this excerpt (after each phrase's background mean is removed). */
  z: z.number().min(-100).max(100),
});
export type SoundEventTag = z.output<typeof soundEventTagSchema>;

/** An event a listening found, timed from the start of what was heard. */
export const soundEventSchema = z.object({
  /** A hit's attack (walked back to within 20 dB of its peak); a swell's peak. */
  at: time,
  shape: z.enum(SOUND_EVENT_SHAPES),
  band: z.enum(SOUND_EVENT_BANDS),
  /** A hit's attack contrast (capped at 60 dB); a swell's rise. */
  contrastDb: z.number().min(0).max(130),
  /** K-weighted level in the next 80 ms above the bed (a swell: its rise). */
  prominenceDb: z.number().min(0).max(130),
  /** The bed it rose from: the median K-weighted level 300 to 20 ms before, floored at −80 dB. */
  bedDb: z.number().min(-130).max(20),
  /** Sample peak over the event's first 50 to 300 ms. */
  peakDbfs: dbfs,
  /** How long it sounds above its bed. */
  lengthMs: z.number().nonnegative().max(600_000),
  /** A swell's build-up, from its low point to its peak. */
  riseMs: z.number().nonnegative().max(60_000).optional(),
  /** The top tag's kind (AST speech ≥ 0.5 makes it 'voice'); absent when the event wasn't tagged. */
  kind: z.enum(SOUND_EVENT_KINDS).optional(),
  /** Its best event phrases, best first. */
  tags: z.array(soundEventTagSchema).max(3).optional(),
  /** AST's top labels, for the most important tagged events. */
  audioSet: z.array(audioSetLabelSchema).max(5).optional(),
  /** At least 12 dB over its bed (or speech): it dominates its excerpt, so its tags are right about twice as often. */
  exposed: z.boolean(),
  /** The event against the nearest beat, when a beat grid was given; positive: after the beat. */
  beatOffsetMs: offsetMs.optional(),
});
export type SoundEvent = z.output<typeof soundEventSchema>;

const sectionTags = z.array(soundTagSchema).max(3);

/** A stretch that sounds alike (CLAP windows merged while similar, split at a novelty peak), with what it is. */
export const soundSectionSchema = z
  .object({
    start: time,
    end: time,
    /**
     * A one-line summary for the agent and logs ('cinematic orchestral music, strings | voice: a man speaking'),
     * built from the tags in English. The window words a section from its tags, never from this.
     */
    label: z.string().min(1).max(300),
    /** Hints: genre, mood, instruments and voice are never validated. */
    genre: sectionTags,
    mood: sectionTags,
    instruments: sectionTags,
    ambience: sectionTags,
    voice: sectionTags,
    /** AST's Music, Speech and Silence over the section; null when its crop budget left the section out. */
    presence: z.object({ music: unit, speech: unit, silence: unit }).nullable(),
    audioSet: z.array(audioSetLabelSchema).max(5).optional(),
    /** Null when near silence (under −70 LUFS) or under 0.4 s. */
    lufs: lufs.nullable(),
    /** Nothing but digital silence. */
    silent: z.boolean(),
  })
  .refine((section) => RationalTime.isAfter(section.end, section.start), {
    message: 'A section ends after it starts',
    path: ['end'],
  });
export type SoundSection = z.output<typeof soundSectionSchema>;
