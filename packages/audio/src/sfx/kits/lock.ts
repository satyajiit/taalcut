// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A kit's takes and its lock (EAR1-D3; earshot kit.plan and the kit.lock.json `kit render` writes). `planKit`
 * names every take as earshot does (take k on seed + k - 1, the seed the sound's own unless the role sets one; one
 * set per pitch), and `lockKit` renders each one (render-take.ts) and measures it from its samples with F6's port
 * of earshot's measures: onset, the loudest 5 ms (`peak_s`, earshot's 1 ms grid), end, length, sample peak,
 * momentary-max loudness, the audit's warning codes, and (a role with `bed_db`) the loudest 50 ms, K-weighted.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { momentaryMaxLufs } from '../../listen/dsp/audit-detectors';
import { takeTimes } from '../../listen/dsp/audit-shape';
import { K_WEIGHTING, sosfilt } from '../../listen/dsp/filters';
import type { SfxBank } from '../bank-source';
import { meanOf, samplePeak, SR, type Channels } from './edits';
import { renderTake, type PlannedTake, type TakeAudio, type TakeRenderDeps } from './render-take';
import { ROLE_ALIGN, roleStem, takeNames, type Kit, type KitAlign } from './schema';
import { pitchLabel } from './pitch';

const MIX_KEYS = ['bed_db', 'offset_ms', 'min_gap_ms', 'width'] as const;

/** Every take `kit` renders, in earshot's order. `kit` has passed `parseKit` against `bank`. */
export function planKit(kit: Kit, bank: SfxBank): PlannedTake[] {
  const out: PlannedTake[] = [];
  for (const [role, spec] of Object.entries(kit.roles)) {
    if (!spec) continue;
    const item = bank.byUpstreamId(spec.sound);
    if (!item) continue;
    const base = spec.seed ?? item.seed;
    const n = spec.takes ?? 1;
    const { pitch, ...edits } = spec.edits ?? {};
    const pitches: (string | number | null)[] = spec.pitches ?? [pitch ?? null];
    for (const p of pitches)
      for (let k = 1; k <= n; k++) {
        const label = spec.pitches && p !== null ? `_${pitchLabel(p)}` : '';
        const file = `${roleStem(role)}${label}${n > 1 || !spec.pitches ? `_${k}` : ''}.wav`;
        out.push({
          role,
          file,
          sound: spec.sound,
          seed: base + k - 1,
          pitch: p,
          edits,
          maxS: spec.max_s ?? null,
          k,
          ...(spec.width !== undefined ? { width: spec.width } : {}),
        });
      }
  }
  return out;
}

/** earshot's 4-decimal rounding of a time in seconds. */
const r4 = (s: number) => Math.round(s * 10_000) / 10_000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** `kit.loud_lufs`: the loudest 50 ms, K-weighted over the channels as they play (a mono take as dual mono). */
export function loudestFiftyMsLufs(channels: Channels): number {
  const played =
    channels.length === 1 ? [channels[0] ?? new Float32Array(), channels[0] ?? new Float32Array()] : channels;
  const n = played[0]?.length ?? 0;
  const power = new Float64Array(n);
  for (const c of played) {
    const k = sosfilt(K_WEIGHTING, c);
    for (let i = 0; i < n; i++) power[i] = (power[i] ?? 0) + (k[i] ?? 0) ** 2;
  }
  // polish._movmax: the largest mean of 50 ms; a shorter take is its whole sum over 50 ms (zero-padded).
  const w = 2400;
  let sum = 0;
  for (let i = 0; i < Math.min(w, n); i++) sum += power[i] ?? 0;
  let best = sum;
  for (let i = w; i < n; i++) {
    sum += (power[i] ?? 0) - (power[i - w] ?? 0);
    best = Math.max(best, sum);
  }
  return r2(-0.691 + 10 * Math.log10(best / w + 1e-24));
}

export interface LockTake {
  readonly file: string;
  readonly seed: number;
  readonly pitch: string | number | null;
  readonly onset_s: number;
  readonly peak_s: number;
  readonly end_s: number;
  readonly dur_s: number;
  readonly peak_db: number;
  readonly lufs_m_max: number;
  readonly checks: readonly string[];
  readonly planned_seed?: number;
  readonly l50_lufs?: number;
  /** The measured L/R correlation of a take set to a width. */
  readonly corr?: number;
  /** Taalcut: the bank file the take is, or was edited from. */
  readonly bank_take: string;
  readonly source: TakeAudio['source'];
}

export interface LockRole {
  readonly sound: string;
  readonly align: KitAlign;
  readonly level_db: number;
  readonly max_s: number | null;
  readonly bed_db?: number;
  readonly offset_ms?: number;
  readonly min_gap_ms?: number;
  readonly width?: number;
  readonly takes: LockTake[];
}

export interface KitLock {
  readonly kit: 1;
  readonly earshot: string;
  readonly bank: string;
  readonly sr: 48_000;
  readonly name: string | null;
  readonly roles: Record<string, LockRole | null>;
  readonly mix?: unknown;
}

/** `kit.corr`: L/R correlation (1 for mono). */
export function correlation(channels: Channels): number {
  const [l, r] = channels;
  if (!l || !r || l === r) return 1;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < l.length; i++) {
    lr += (l[i] ?? 0) * (r[i] ?? 0);
    ll += (l[i] ?? 0) ** 2;
    rr += (r[i] ?? 0) ** 2;
  }
  return lr / (Math.sqrt(ll * rr) + 1e-20);
}

/** A rendered take's lock row: what earshot measures of it. */
export function lockRow(planned: PlannedTake, audio: TakeAudio, bedDb: boolean): LockTake {
  const mono = meanOf(audio.channels);
  const times = takeTimes(mono);
  return {
    file: planned.file,
    seed: audio.source === 'bank' ? audio.seed : planned.seed,
    pitch: planned.pitch,
    onset_s: r4(times.onsetS),
    peak_s: r4(times.peakS),
    end_s: r4(times.endS),
    dur_s: r4(mono.length / SR),
    peak_db: r2(20 * Math.log10(samplePeak(audio.channels) + 1e-12)),
    // polish.lufs_max sums the channels a take has: a mono take is one channel here (l50 counts it twice).
    lufs_m_max: r2(momentaryMaxLufs(audio.channels)),
    checks: audio.audit.warnings.map((w) => w.code),
    ...(audio.source === 'bank' && audio.seed !== planned.seed ? { planned_seed: planned.seed } : {}),
    ...(bedDb ? { l50_lufs: loudestFiftyMsLufs(audio.channels) } : {}),
    ...(planned.width !== undefined ? { corr: Math.round(correlation(audio.channels) * 1000) / 1000 } : {}),
    bank_take: audio.take.file,
    source: audio.source,
  };
}

/** Renders every take of `kit` and locks them; `takes` holds the audio by lock file. */
export async function lockKit(
  deps: TakeRenderDeps,
  kit: Kit,
): AsyncResult<{ lock: KitLock; takes: Map<string, TakeAudio> }> {
  const roles: Record<string, LockRole | null> = {};
  for (const [role, spec] of Object.entries(kit.roles))
    roles[role] = spec
      ? {
          sound: spec.sound,
          align: spec.align ?? ROLE_ALIGN[role] ?? 'onset',
          level_db: spec.level_db ?? 0,
          max_s: spec.max_s ?? null,
          ...Object.fromEntries(
            MIX_KEYS.flatMap((key) => (spec[key] !== undefined ? [[key, spec[key]]] : [])),
          ),
          takes: [],
        }
      : null;
  const takes = new Map<string, TakeAudio>();
  for (const planned of planKit(kit, deps.bank)) {
    const audio = await renderTake(deps, planned);
    if (!audio.ok) return audio;
    takes.set(planned.file, audio.value);
    const spec = kit.roles[planned.role];
    roles[planned.role]?.takes.push(lockRow(planned, audio.value, spec?.bed_db !== undefined));
  }
  return ok({
    lock: {
      kit: 1,
      earshot: deps.bank.catalogue.upstream.version,
      bank: deps.bank.catalogue.upstream.bank,
      sr: 48_000,
      name: kit.name ?? null,
      roles,
      ...(kit.mix !== undefined ? { mix: kit.mix } : {}),
    },
    takes,
  });
}

/** The lock files `kit` names (takeNames), for a caller checking its own plan. */
export const lockFiles = (kit: Kit) => takeNames(kit).map(([, file]) => file);
