// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A film's kit, schema 1 (EAR1-D3; earshot forge/kit.py): a bank sound per role, how many takes, the knobs every
 * take gets (`dur`, `apex`, `pitch`, `peak_db`, `weight`), the sync point a mixer puts on the cue (`onset`, `peak`,
 * `end`), its level, earshot 0.4's mix keys, and `null` for a role that isn't sounded. `parseKit` checks the shape
 * and then what a render would refuse against the installed bank, every problem named in one
 * `audio.kit_invalid`: an unknown or withheld sound, knob values out of range or for a sound that can't take them,
 * a level over 0 dBFS, take files that would share a name.
 */
import { err, ok, sfxKitRoleSchema, type Result } from '@taalcut/core';
import { z } from 'zod';
import { KitInvalid } from '../../listen/errors';
import type { SfxBank } from '../bank-source';
import { pitchHz, pitchLabel } from './pitch';

export const KIT_SCHEMA = 1;
/** The shared vocabulary of a film's cue kinds; other role names are allowed. */
export const KIT_ROLES = [
  'tick',
  'tick.crisp',
  'tock',
  'hit',
  'land',
  'land.light',
  'pop',
  'whoosh.short',
  'whoosh.long',
  'suck',
  'riser',
  'drop',
  'key',
  'key.space',
  'key.return',
  'click',
  'click.confirm',
  'snap',
  'swell',
  'bell',
  'text',
] as const;
export const KIT_ALIGNS = ['onset', 'peak', 'end'] as const;
export type KitAlign = (typeof KIT_ALIGNS)[number];
/** The default sync point by role: whooshes on their apex, builds on their end, the rest on their onset. */
export const ROLE_ALIGN: Readonly<Record<string, KitAlign>> = {
  'whoosh.short': 'peak',
  'whoosh.long': 'peak',
  suck: 'end',
  riser: 'end',
  swell: 'end',
};
export const MAX_TAKES = 32;
/** The categories whose loudest moment earshot can aim (knobs.WHOOSH), and the pass engine's longest render. */
const WHOOSH_MAX_S = 4.4;

const num = z.number().finite();
const pitchValue = z.union([z.string().max(16), z.number()]);

export const kitEditsSchema = z
  .object({
    dur: num.optional(),
    apex: num.optional(),
    pitch: pitchValue.optional(),
    peak_db: num.optional(),
    weight: num.optional(),
  })
  .strict();
export type KitEdits = z.output<typeof kitEditsSchema>;

export const kitRoleSchema = z
  .object({
    sound: z.string().max(80),
    takes: z.int().optional(),
    seed: z.int().nonnegative().optional(),
    edits: kitEditsSchema.nullable().optional(),
    pitches: z.array(pitchValue).min(1).max(48).optional(),
    align: z.enum(KIT_ALIGNS).optional(),
    max_s: num.nullable().optional(),
    level_db: num.optional(),
    note: z.string().max(2000).optional(),
    bed_db: num.min(0.5).max(30).optional(),
    offset_ms: num.min(-500).max(500).optional(),
    min_gap_ms: num.min(0).max(2000).optional(),
    width: num.min(0).max(1).optional(),
  })
  .strict();
export type KitRole = z.output<typeof kitRoleSchema>;

const pair = z.tuple([num, num]).refine(([lo, hi]) => lo <= hi, { message: 'a [lo, hi] pair' });
export const kitMixSchema = z
  .object({
    duck_db: num.optional(),
    stop_down: z
      .object({
        before: z.array(z.string()).optional(),
        depth_db: pair.optional(),
        length_s: pair.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export const kitSchema = z
  .object({
    kit: z.literal(KIT_SCHEMA),
    name: z.string().max(80).optional(),
    sr: z.literal(48_000).optional(),
    note: z.string().max(4000).optional(),
    roles: z.record(sfxKitRoleSchema, kitRoleSchema.nullable()),
    off: z.record(z.string(), z.string().max(2000)).optional(),
    mix: kitMixSchema.optional(),
  })
  .strict()
  .refine((kit) => Object.keys(kit.roles).length > 0, { message: 'roles: a non-empty object' });
export type Kit = z.output<typeof kitSchema>;

/** The lock's file name stem of a role: dots become dashes ('tick.crisp' → 'tick-crisp'). */
export const roleStem = (role: string) => role.replaceAll('.', '-');

/** The take files a kit writes ([role, file, pitch]), as earshot names them. */
export function takeNames(kit: Kit): [string, string, string | number | null][] {
  const out: [string, string, string | number | null][] = [];
  for (const [role, spec] of Object.entries(kit.roles)) {
    if (!spec) continue;
    const n = spec.takes !== undefined && spec.takes >= 1 && spec.takes <= MAX_TAKES ? spec.takes : 1;
    const pitches: (string | number | null)[] = spec.pitches ?? [null];
    for (const p of pitches) {
      const label = p === null ? null : pitchLabel(p);
      if (p !== null && label === null) continue;
      for (let k = 1; k <= n; k++)
        out.push([
          role,
          `${roleStem(role)}${label ? `_${label}` : ''}${n > 1 || !spec.pitches ? `_${k}` : ''}.wav`,
          p,
        ]);
    }
  }
  return out;
}

function levelProblem(edits: KitEdits): string | null {
  const peak = edits.peak_db ?? -1;
  if (peak > 0) return `peak_db ${peak} is over 0 dBFS: the take would clip (use 0 or less)`;
  if (edits.weight !== undefined) {
    if (!(edits.weight > 0 && edits.weight <= 4)) return `weight must be in (0, 4], got ${edits.weight}`;
    if (peak + 20 * Math.log10(edits.weight) > 0)
      return `weight ${edits.weight} at peak_db ${peak} is over 0 dBFS`;
  }
  return null;
}

function roleProblems(role: string, spec: KitRole, bank: SfxBank): string[] {
  const out: string[] = [];
  const item = bank.byUpstreamId(spec.sound);
  if (!item) {
    const withheld = bank.catalogue.withheld.some((w) => w.id === spec.sound || w.upstreamId === spec.sound);
    out.push(`${role}: ${withheld ? 'withheld' : 'unknown'} sound ${spec.sound}`);
  }
  if (spec.takes !== undefined && !(spec.takes >= 1 && spec.takes <= MAX_TAKES))
    out.push(`${role}: takes must be an integer 1-${MAX_TAKES}`);
  const edits = spec.edits ?? {};
  if (spec.pitches && edits.pitch !== undefined) out.push(`${role}: give edits.pitch or pitches, not both`);
  if (spec.max_s !== undefined && spec.max_s !== null && spec.max_s < 0.01)
    out.push(`${role}: max_s must be 0.01 s or more`);
  const level = levelProblem(edits);
  if (level) out.push(`${role}: ${level}`);
  if (edits.dur !== undefined && !(edits.dur >= 0.01 && edits.dur <= 60))
    out.push(`${role}: dur must be 0.01-60 s`);
  if (!item) return out;
  if (edits.dur !== undefined && item.knobs.apex && edits.dur > WHOOSH_MAX_S)
    out.push(`${role}: the pass engine renders at most ${WHOOSH_MAX_S} s`);
  if (edits.apex !== undefined) {
    if (!item.knobs.apex) out.push(`${role}: apex applies to the whoosh family; align a riser on its end`);
    else if (
      !(edits.apex >= 0.01 && edits.apex <= WHOOSH_MAX_S - 0.1) ||
      (edits.dur !== undefined && edits.apex >= edits.dur - 0.02)
    )
      out.push(`${role}: apex ${edits.apex} s must lie inside the sound`);
  }
  for (const p of spec.pitches ?? (edits.pitch !== undefined ? [edits.pitch] : [])) {
    const hz = pitchHz(p);
    const knob = item.knobs.pitch;
    if (hz === null) out.push(`${role}: pitch ${JSON.stringify(p)} is no note name or Hz`);
    else if (!knob) out.push(`${role}: ${item.upstreamId} takes no pitch`);
    else if (hz < knob.rangeHz[0] * 0.999 || hz > knob.rangeHz[1] * 1.001)
      out.push(`${role}: pitch ${p} is outside ${knob.rangeHz[0]}-${knob.rangeHz[1]} Hz`);
  }
  return out;
}

function nameProblems(kit: Kit): string[] {
  const seen = new Map<string, [string, string, string | number | null]>();
  const out = new Set<string>();
  for (const entry of takeNames(kit)) {
    const [role, file, p] = entry;
    const prev = seen.get(file.toLowerCase());
    if (!prev) {
      seen.set(file.toLowerCase(), entry);
      continue;
    }
    out.add(
      prev[0] === role && p !== null
        ? `${role}: pitches ${prev[2]} and ${p} are one pitch (${file})`
        : `${role}: take file ${file} is also ${prev[1]} of role ${prev[0]}`,
    );
  }
  return [...out];
}

/** What is wrong with `kit` against `bank`; [] when a render can use it. */
export function kitProblems(kit: Kit, bank: SfxBank): string[] {
  const out: string[] = [];
  for (const [role, spec] of Object.entries(kit.roles)) if (spec) out.push(...roleProblems(role, spec, bank));
  for (const role of kit.mix?.stop_down?.before ?? [])
    if (!(role in kit.roles)) out.push(`mix.stop_down.before: ${role} is no role of this kit`);
  return [...out, ...nameProblems(kit)];
}

/** A kit file's JSON, checked: its shape, then against the bank. */
export function parseKit(json: unknown, bank: SfxBank): Result<Kit> {
  const parsed = kitSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || 'kit'}: ${issue.message}`)
      .join('; ');
    return err(KitInvalid(undefined, { detail: `invalid kit: ${detail}`.slice(0, 1000) }));
  }
  const problems = kitProblems(parsed.data, bank);
  if (problems.length > 0)
    return err(KitInvalid(undefined, { detail: `invalid kit: ${problems.join('; ')}`.slice(0, 1000) }));
  return ok(parsed.data);
}
