// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1: what a listening judges (listening.ts has what it hears). The sync of each cut to a sound (earshot timeline
 * sync), the model-free audit of clicks, clipping and the rest (earshot sfx check), the launch-film critique with
 * its timestamped fixes (earshot critique), and whether a sound is a real recording (earshot realness). Render's QA
 * reads them from a render's listening (`soundOnCuts`, `soundClean`, `soundCritique`); a template keeps the reel's
 * cut sync (template-audio.ts).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { commandNameSchema } from '../commands/definition';
import { frameRateSchema } from '../time/frame-rate-value';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import { listenModelSchema, soundEventSchema, soundMeasuresSchema } from './listening';

const time = rationalTimeSchema;
const unit = z.number().min(0).max(1);
/** The sound against its cut, signed: negative when the sound comes early. */
const syncOffsetMs = z.number().min(-1000).max(1000);

/** The most cuts one sync report covers (a template has at most 200 slots; a render's cuts are its timeline's). */
export const CUT_SYNC_MAX_CUTS = 2000;

/**
 * What answers a cut, the first rule that matches (earshot timeline `_answer`): `ok` an onset within one frame (40 ms
 * without a frame rate); `near` within 100 ms; `swell` a build-up peaking within 300 ms; `peak` a level rise of 3 dB
 * or more within 150 ms that no onset shows; `off` a strong onset within 250 ms; `none` no sound.
 */
export const CUT_SYNC_STATUSES = ['ok', 'near', 'swell', 'peak', 'off', 'none'] as const;
export type CutSyncStatus = (typeof CUT_SYNC_STATUSES)[number];
/** The statuses that count as a cut without a hit. */
export const CUT_SYNC_MISSES = ['peak', 'off', 'none'] as const satisfies readonly CutSyncStatus[];

export const cutSyncItemSchema = z.object({
  /** Index into the cuts asked about; for a template's reel, the slot whose cut it is. */
  cutIndex: z.int().nonnegative(),
  at: time,
  status: z.enum(CUT_SYNC_STATUSES),
  /** Event minus cut; null for `none`. */
  offsetMs: syncOffsetMs.nullable(),
  /** The answering event's time; absent for `none`. */
  eventAt: time.optional(),
  prominenceDb: z.number().min(0).max(130).optional(),
  /** The nearest accent (a deliberate hit: the top 20 %, 6 dB or more over its bed) within 100 ms. */
  accentOffsetMs: syncOffsetMs.optional(),
  /** The cut against the nearest beat, when beats were given; positive: after the beat. */
  beatOffsetMs: z.number().min(-60_000).max(60_000).optional(),
});
export type CutSyncItem = z.output<typeof cutSyncItemSchema>;

export const cutSyncReportSchema = z.object({
  items: z.array(cutSyncItemSchema).max(CUT_SYNC_MAX_CUTS),
  /** Indices of the cuts without a hit (CUT_SYNC_MISSES), increasing. */
  cutsWithoutHit: z.array(z.int().nonnegative()).max(CUT_SYNC_MAX_CUTS),
  /** Share of cuts `ok`. */
  okShare: unit,
  /** Share of cuts `ok` or `near` (an onset within 100 ms). */
  nearShare: unit,
  /** What chance gives: the share of times every 5 ms, from 1 s before the first cut to 1 s after the last, within the tolerance of an event. */
  chanceShare: unit,
  /** The median of the absolute offsets of the answered cuts; null when none is answered. */
  medianOffsetMs: z.number().nonnegative().max(1000).nullable(),
  /** `ok`'s window: one frame at `frameRate`, else 40 ms. */
  toleranceMs: z.number().positive().max(1000),
  /** The picture's frame rate, when it set the tolerance. */
  frameRate: frameRateSchema.optional(),
  /** Share of cuts within 50 ms of a beat, and what chance gives; when beats were given. */
  onBeatShare: unit.optional(),
  onBeatChance: unit.optional(),
});
export type CutSyncReport = z.output<typeof cutSyncReportSchema>;

/**
 * The audit's findings (earshot forge/sfx check): it measures, never listens. `click` a discontinuity inside;
 * `edge` a first or last sample off zero; `clipping` flat tops or overs; `dc_offset`; `ringing` a metallic comb in
 * the tail; `silence` digital silence inside; `near_silent` nothing to hear; `rising_glide` a tonal climb of more than
 * 4 semitones (the cheap synth whip); `truncated_tail` a tail cut while still decaying; `tail_rise` a tail that rises
 * again; `stacked_attack` two attacks where one hit was meant; `pre_swell` a build of more than 100 ms before a hit.
 */
export const SOUND_AUDIT_KINDS = [
  'click',
  'edge',
  'clipping',
  'dc_offset',
  'ringing',
  'silence',
  'near_silent',
  'rising_glide',
  'truncated_tail',
  'tail_rise',
  'stacked_attack',
  'pre_swell',
] as const;
export type SoundAuditKind = (typeof SOUND_AUDIT_KINDS)[number];
/** A warning fails the audit; a note is information (a designed stop, a drip's rising bubble). */
export const SOUND_AUDIT_SEVERITIES = ['warning', 'note'] as const;
export type SoundAuditSeverity = (typeof SOUND_AUDIT_SEVERITIES)[number];

export const soundAuditFindingSchema = z.object({
  kind: z.enum(SOUND_AUDIT_KINDS),
  severity: z.enum(SOUND_AUDIT_SEVERITIES),
  /** Where it is, when it is at one place. */
  at: time.optional(),
  /** For developers and logs, in English (the measured value and rule); the window words each kind itself. */
  detail: z.string().max(300),
});
export type SoundAuditFinding = z.output<typeof soundAuditFindingSchema>;

export const soundAuditReportSchema = z
  .object({
    /** No warning. */
    ok: z.boolean(),
    findings: z.array(soundAuditFindingSchema).max(200),
  })
  .refine((report) => report.ok === !report.findings.some((finding) => finding.severity === 'warning'), {
    message: 'An audit is ok exactly when it has no warning',
    path: ['ok'],
  });
export type SoundAuditReport = z.output<typeof soundAuditReportSchema>;

/** What a sound is critiqued against: earshot's launch-film profile, or the template reel's own sound. */
export const SOUND_CRITIQUE_PROFILES = ['launch', 'reference'] as const;
export type SoundCritiqueProfile = (typeof SOUND_CRITIQUE_PROFILES)[number];
/** Launch-grade at a score of 0.9 with no critical issue; close at 0.75 with none; needs work from 0.5. */
export const SOUND_CRITIQUE_VERDICTS = ['launch_grade', 'close', 'needs_work', 'not_launch_grade'] as const;
export type SoundCritiqueVerdict = (typeof SOUND_CRITIQUE_VERDICTS)[number];

/**
 * The 23 scored metrics (earshot critique SPEC, its snake_case ids in camelCase), by weight. Critical (3):
 * integrated loudness, realness, music share. Major (2): true peak, cuts with sound, loudness range, crest, the
 * final moment, onset and hit rates, time to first sound, dead air at the end, the longest gap. Minor (1): opening
 * and closing level, fade length, the six band shares, stereo width.
 */
export const SOUND_CRITIQUE_METRICS = [
  'lufsI',
  'pReal',
  'musicFrac',
  'truePeak',
  'cutsWithSound',
  'lra',
  'crestLu',
  'finalLu',
  'onsetRate',
  'hitRate',
  'firstSoundS',
  'endSilenceS',
  'maxGapS',
  'introLu',
  'endLu',
  'fadeS',
  'bandSub',
  'bandLow',
  'bandLowmid',
  'bandMid',
  'bandPresence',
  'bandAir',
  'sideToMidDb',
] as const;
export type SoundCritiqueMetricId = (typeof SOUND_CRITIQUE_METRICS)[number];
export const SOUND_METRIC_STATUSES = ['ok', 'low', 'high', 'na'] as const;
export type SoundMetricStatus = (typeof SOUND_METRIC_STATUSES)[number];
/** 3 critical, 2 major, 1 minor. */
export const SOUND_METRIC_WEIGHTS = [1, 2, 3] as const;

export const soundCritiqueMetricSchema = z.object({
  id: z.enum(SOUND_CRITIQUE_METRICS),
  /** As scored: a critical near miss counts as major, a near-real sound's realness as minor. */
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** In the metric's unit (LUFS, dBTP, LU, dB, a share, per second, seconds, p); null when not measurable. */
  value: z.number().nullable(),
  /** The window the value should sit in, a side null when open; null without reference data (status `na`). */
  range: z.object({ min: z.number().nullable(), max: z.number().nullable() }).nullable(),
  status: z.enum(SOUND_METRIC_STATUSES),
});
export type SoundCritiqueMetric = z.output<typeof soundCritiqueMetricSchema>;

/** A key into the catalogue: 'audio.critique.fix.lufsLow'. */
const messageKeySchema = z
  .string()
  .max(120)
  .regex(/^[a-z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)*$/);

/** One fix, in words the window looks up, with where in the video it applies and, when it can, the command. */
export const soundCritiqueFixSchema = z.object({
  metricId: z.enum(SOUND_CRITIQUE_METRICS).optional(),
  messageKey: messageKeySchema,
  /** The message's values: ids, numbers and short words, never user text. */
  params: z.record(z.string().max(40), z.union([z.string().max(200), z.number()])),
  at: time.optional(),
  /** A ready command: the Editor or the QA card's fix button dispatches it as it is. */
  command: z.object({ name: commandNameSchema, payload: z.unknown() }).optional(),
});
export type SoundCritiqueFix = z.output<typeof soundCritiqueFixSchema>;

export const soundCritiqueSchema = z.object({
  profile: z.enum(SOUND_CRITIQUE_PROFILES),
  verdict: z.enum(SOUND_CRITIQUE_VERDICTS),
  /** The weights of the metrics in range over the weights of those scored. */
  score: unit,
  /** Some metric could not be scored (no realness or AST model, no cuts, too short): the score covers the rest. */
  partial: z.boolean(),
  metrics: z.array(soundCritiqueMetricSchema).max(SOUND_CRITIQUE_METRICS.length),
  /** Most important first. */
  fixes: z.array(soundCritiqueFixSchema).max(30),
});
export type SoundCritique = z.output<typeof soundCritiqueSchema>;

/** Real recording or code-synthesised (earshot realness: a logistic head on CLAP, a pure tone capped at 0.03). */
export const SOUND_REALNESS_VERDICTS = ['real', 'uncertain', 'synthetic', 'silent'] as const;
export type SoundRealnessVerdict = (typeof SOUND_REALNESS_VERDICTS)[number];

const pReal = unit.nullable();
export const soundRealnessSchema = z
  .object({
    /** The probability it is a real recording or a pro production; null for silence. */
    pReal,
    verdict: z.enum(SOUND_REALNESS_VERDICTS),
    /** Over 6 s, the 4 s windows it averaged (a silent window's pReal is null). */
    windows: z
      .array(
        z
          .object({ start: time, end: time, pReal })
          .refine((window) => RationalTime.isAfter(window.end, window.start), {
            message: 'A window ends after it starts',
            path: ['end'],
          }),
      )
      .max(1000)
      .optional(),
    /** D23: pReal sits near a verdict threshold (quantised models drift), so the verdict may read either way. */
    borderline: z.boolean().optional(),
  })
  .refine((realness) => (realness.pReal === null) === (realness.verdict === 'silent'), {
    message: 'Only silence has no pReal',
    path: ['pReal'],
  });
export type SoundRealness = z.output<typeof soundRealnessSchema>;

/** The most events a render's listening carries (a template keeps fewer: TEMPLATE_LISTENING_EVENTS_MAX). */
export const RENDER_LISTENING_EVENTS_MAX = 4000;

/** What the SoundListener port (ports/sound-listener.ts) hears in a render, for render's QA. */
export const renderListeningSchema = z.object({
  measures: soundMeasuresSchema,
  events: z.array(soundEventSchema).max(RENDER_LISTENING_EVENTS_MAX),
  cutSync: cutSyncReportSchema,
  audit: soundAuditReportSchema,
  /** Null when it can't be critiqued (too short, near silence, or no model for it). */
  critique: soundCritiqueSchema.nullable(),
  realness: soundRealnessSchema.nullable(),
  /** Null when no model ran: measurements, events, sync and the audit are signal processing only. */
  model: listenModelSchema.nullable(),
});
export type RenderListening = z.output<typeof renderListeningSchema>;
