// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model-free audit of one sound effect (earshot forge/sfx.py `check`): it measures, never listens. Warnings
 * make it fail; notes are information. `category` (a bank category) and `role` (a kit role) give context: a riser
 * may stop on its peak, a glitch's clicks and gaps are its design, a drip's bubble may climb, and a hit role makes
 * stacked attacks and a long pre-swell warnings. `toSoundAuditReport` gives core's SoundAuditReport.
 */
import {
  RationalTime,
  type SoundAuditFinding,
  type SoundAuditKind,
  type SoundAuditReport,
} from '@taalcut/core';
import {
  attackOf,
  clippingRuns,
  crestDb,
  dcDb,
  detectClicks,
  innerSilenceMs,
  liveMs,
  tailOf,
  truncatedDb,
} from './audit-detectors';
import { checkpoint } from '../abort';
import { resonanceOf, ringOf } from './audit-ring';
import { layersOf, risingGlide, type Glide, type Layers } from './audit-shape';
import { LISTEN_SR, roundTo, stereoOf, type ListenAudio } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';

const GLIDE_ST = 4.0;
const GLIDE_MIN_S = 0.05;
const PRE_SWELL_MS = 100.0;
const SILENT_DBFS = -60.0;
const SILENT_MS = 5.0;
const HIT_ROLES = ['hit', 'land'];
const GATED = ['glitch', 'pro_glitch', 'riser', 'pro_riser', 'pro_zip', 'pro_impact'];
const DESIGNED = ['glitch', 'pro_glitch'];
const HIT_CATEGORIES = ['impact', 'pro_impact', 'logo_sting', 'pro_logo_sting'];
/** recipes/drip.py: the climb a bubble makes. */
const DRIP = { maxSt: 14.0, maxS: 0.25, startS: 0.06 };

/** earshot's warning codes. */
export type AuditCode =
  | 'silent'
  | 'clicks'
  | 'edge'
  | 'clipping'
  | 'dc'
  | 'ring'
  | 'truncated'
  | 'silence'
  | 'tail'
  | 'rising_glide'
  | 'stacked'
  | 'pre_swell';

export interface AuditItem {
  readonly code: AuditCode;
  /** Upstream's message, for developers and logs. */
  readonly detail: string;
  /** Where, seconds, when it is at one place (the clicks' times when several). */
  readonly at?: readonly number[];
}

export interface AuditMeasures {
  readonly clicks: number;
  readonly clickTimes: readonly number[];
  readonly edgeDb: number;
  readonly clipRuns: number;
  readonly overs: number;
  readonly dcDb: number;
  readonly ringZ: number | null;
  readonly ringMs: number | null;
  readonly truncDb: number | null;
  readonly silenceMs: number;
  readonly bumpDb: number;
  readonly attackMs: number | null;
  readonly t40Ms: number | null;
  readonly crestDb: number;
  readonly resDb: number;
  readonly resHz: number | null;
  readonly peakDbfs: number | null;
  readonly liveMs: number;
}

export interface SoundAudit {
  readonly ok: boolean;
  readonly warnings: readonly AuditItem[];
  readonly notes: readonly AuditItem[];
  readonly measures: AuditMeasures;
  readonly glide: Glide;
  readonly layers: Layers;
}

export interface AuditContext {
  /** A bank category ('riser', 'glitch', 'drip', 'pro_impact', …). */
  readonly category?: string;
  /** A kit role ('hit', 'land', …). */
  readonly role?: string;
  /** Stops between detectors (abort.ts `checkpoint`: it unwinds; the analysis returns core.cancelled). */
  readonly signal?: AbortSignal;
}

function mono64(channels: readonly Float32Array[]): Float64Array {
  const [a, b] = channels;
  const n = a?.length ?? 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = b && b !== a ? ((a?.[i] ?? 0) + (b[i] ?? 0)) / 2 : (a?.[i] ?? 0);
  return out;
}

const f0 = (v: number) => v.toFixed(0);

/** sfx.check(x, category, role) on 48 kHz audio. */
export async function auditSound(
  audio: ListenAudio,
  runner: SpectrogramRunner,
  context: AuditContext = {},
): Promise<SoundAudit> {
  const { category, role, signal } = context;
  const x = stereoOf(audio);
  const channels = [x.left, x.right];
  const m = mono64(channels);
  await checkpoint(signal);
  const clicks = detectClicks(m);
  await checkpoint(signal);
  const clip = clippingRuns(channels);
  const dc = dcDb(m);
  const ring = ringOf(m);
  const trunc = truncatedDb(m);
  const silenceMs = innerSilenceMs(m);
  const attack = attackOf(m);
  const tail = tailOf(m);
  await checkpoint(signal);
  const res = resonanceOf(m);
  await checkpoint(signal);
  const glide = await risingGlide(m, runner);
  await checkpoint(signal);
  const layers = layersOf(m);
  const warnings: AuditItem[] = [];
  const notes: AuditItem[] = [];
  const add = (code: AuditCode, detail: string, soft = false, at?: readonly number[]) =>
    (soft ? notes : warnings).push({ code, detail, ...(at && at.length > 0 ? { at } : {}) });
  const designed = category !== undefined && DESIGNED.includes(category);
  let argPeak = 0;
  let pk = 0;
  for (let i = 0; i < m.length; i++) {
    if (Math.abs(m[i] ?? 0) > Math.abs(m[argPeak] ?? 0)) argPeak = i;
  }
  for (const c of channels) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i] ?? 0));
  const gated =
    (category !== undefined && GATED.includes(category)) || (m.length > 0 && argPeak >= 0.97 * m.length);
  const peakDbfs = pk > 0 ? 20 * Math.log10(pk) : -Infinity;
  const live = liveMs(m);
  if (peakDbfs < SILENT_DBFS || live < SILENT_MS) {
    add(
      'silent',
      pk === 0
        ? 'digital silence: nothing to hear'
        : `nearly silent: peak ${f0(peakDbfs)} dBFS, ${live.toFixed(1)} ms within 40 dB of its peak`,
    );
  }
  if (clicks.clicks)
    add(
      'clicks',
      `${clicks.clicks} click(s) at ${clicks.clickTimes
        .slice(0, 4)
        .map((t) => `${t.toFixed(3)} s`)
        .join(', ')}`,
      designed,
      clicks.clickTimes,
    );
  if (clicks.edgeDb > -40)
    add('edge', `starts or ends off zero (${f0(clicks.edgeDb)} dB re peak): it clicks when played`);
  if (clip.clipRuns || clip.overs)
    add('clipping', `clipped: ${clip.clipRuns} flat tops, ${clip.overs} samples over full scale`);
  if (dc > -40) add('dc', `DC offset ${f0(dc)} dB re peak`);
  if (ring.ringZ !== null && ring.ringZ > 15) {
    add(
      'ring',
      `metallic comb ring in the tail every ${(ring.ringMs ?? 0).toFixed(1)} ms (z ${f0(ring.ringZ)})`,
    );
  }
  if (trunc.truncDb !== null && trunc.truncDb > -45) {
    add(
      'truncated',
      `tail cut at ${f0(trunc.truncDb)} dB re peak${gated ? ' (the stop is the design)' : ''}`,
      gated,
      [m.length / LISTEN_SR],
    );
  }
  if (silenceMs > 4) add('silence', `${f0(silenceMs)} ms of digital silence inside`, designed);
  if (tail.bumpDb > 6) add('tail', `the tail rises again by ${f0(tail.bumpDb)} dB`, true);
  if (
    glide.riseSt > GLIDE_ST &&
    glide.fromS !== null &&
    glide.toS !== null &&
    glide.toS - glide.fromS >= GLIDE_MIN_S
  ) {
    const bubble =
      category === 'drip' &&
      glide.riseSt <= DRIP.maxSt &&
      glide.fromS <= DRIP.startS &&
      glide.toS - glide.fromS <= DRIP.maxS;
    const span = `${f0(1000 * (glide.toS - glide.fromS))} ms (${glide.fromS.toFixed(2)}-${glide.toS.toFixed(2)} s)`;
    add('rising_glide', `pitch climbs ${f0(glide.riseSt)} semitones over ${span}`, bubble, [glide.fromS]);
  }
  const hit = role !== undefined && HIT_ROLES.includes(role);
  if (hit || (category !== undefined && HIT_CATEGORIES.includes(category))) {
    if (layers.count >= 2)
      add('stacked', `${layers.count} separate attacks`, !hit, layers.attacks.slice(1, 2));
    if (layers.preSwellMs > PRE_SWELL_MS)
      add('pre_swell', `${f0(layers.preSwellMs)} ms of build before the hit`, !hit);
  }
  return {
    ok: warnings.length === 0,
    warnings,
    notes,
    measures: {
      ...clicks,
      ...clip,
      dcDb: dc,
      ringZ: ring.ringZ,
      ringMs: ring.ringMs,
      truncDb: trunc.truncDb,
      silenceMs,
      bumpDb: tail.bumpDb,
      attackMs: attack.attackMs,
      t40Ms: tail.t40Ms,
      crestDb: crestDb(m),
      ...res,
      peakDbfs: Number.isFinite(peakDbfs) ? roundTo(peakDbfs, 2) : null,
      liveMs: roundTo(live, 2),
    },
    glide,
    layers,
  };
}

/** earshot's codes as core's audit kinds. */
export const AUDIT_KINDS: Readonly<Record<AuditCode, SoundAuditKind>> = {
  silent: 'near_silent',
  clicks: 'click',
  edge: 'edge',
  clipping: 'clipping',
  dc: 'dc_offset',
  ring: 'ringing',
  truncated: 'truncated_tail',
  silence: 'silence',
  tail: 'tail_rise',
  rising_glide: 'rising_glide',
  stacked: 'stacked_attack',
  pre_swell: 'pre_swell',
};

const MS_RATE = { num: 1000, den: 1 } as const;

/** Core's report: one finding per warning or note (a click per time), positions at 1 ms. */
export function toSoundAuditReport(audit: SoundAudit): SoundAuditReport {
  const findings: SoundAuditFinding[] = [];
  for (const [items, severity] of [
    [audit.warnings, 'warning'],
    [audit.notes, 'note'],
  ] as const) {
    for (const item of items) {
      const times = item.code === 'clicks' ? (item.at ?? []) : (item.at ?? []).slice(0, 1);
      const base = { kind: AUDIT_KINDS[item.code], severity, detail: item.detail.slice(0, 300) };
      if (times.length === 0) findings.push(base);
      for (const t of times)
        findings.push({ ...base, at: RationalTime.fromSeconds(Math.max(0, t), MS_RATE) });
    }
  }
  return { ok: audit.ok, findings: findings.slice(0, 200) };
}
