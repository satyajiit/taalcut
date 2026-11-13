// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The small parts of the skill contract that plan steps and flow cards name
 * (they can't import the whole contract, which names cards): a skill's id,
 * the stored things a skill hands off, and the questions a skill may ask.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { LIBRARY_ENTITIES } from '../events/library-entities';

/** '<module id>.<camelCase>', e.g. 'templates.analyst'. */
export const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;
export const skillIdSchema = z.string().regex(SKILL_ID_PATTERN);

/** A stored thing a skill made, at the version it handed off. Flows watch these for the user's edits. */
export const entityRefSchema = z.object({
  entity: z.enum(LIBRARY_ENTITIES),
  id: z.string().min(1).max(64),
  version: z.int().nonnegative(),
});
export type EntityRef = z.output<typeof entityRefSchema>;

/** Questions a skill may ask, once per run, on its step card (how many variants; P3-B8: how to fill the gaps). */
export const SKILL_QUESTIONS = ['variants', 'gapFix'] as const;
export type SkillQuestion = (typeof SKILL_QUESTIONS)[number];

/**
 * P3-B8: the ways to fill a gap (or a weak slot): film it, generate a still, use stock, or drop the slot. FIX-GAPS: a
 * weak pick (casting's confidence under its line) may also swap to one of its next-best candidates, or keep its clip.
 * FIX-ASK: any gap may also wait for clips the person adds (`addClips`, then the open gaps are cast again), take the
 * clip another shot has when it fits this one clearly better (`borrow`: that shot gets another clip), or use another
 * part of a clip a shot already shows (`reuse`, only when the person chooses it).
 */
export const GAP_FIX_KINDS = [
  'film',
  'generate',
  'stock',
  'drop',
  'swap',
  'keep',
  'addClips',
  'borrow',
  'reuse',
] as const;
export type GapFixKind = (typeof GAP_FIX_KINDS)[number];
