// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  FORMAT_IDS,
  isPlaceholderText,
  ok,
  ValidationError,
  type CameraMotion,
  type FormatId,
  type Result,
  type ShotType,
} from '@taalcut/core';
import type { SlotRole, TextRole } from '../types';
import { boxFitsSafe, type TextBox } from './boxes';
import type { AllocationConstraint } from './constraints/types';

/** Beats per slot: a fixed range, or the shared body / hook range from the planner. */
export type SectionBeats =
  'hook' | 'body' | { readonly min: number; readonly pref: number; readonly max: number };

export interface IntentSeed {
  readonly text: string;
  readonly shotType: ShotType | null;
  readonly motion: CameraMotion | null;
  readonly subject: string | null;
  readonly people: number | null;
  readonly energy: number;
}

export interface SectionLabel {
  readonly text: string;
  readonly role: TextRole;
  readonly box?: TextBox;
  /** On every slot of the section, not only the first. */
  readonly every?: boolean;
  /** When set, this wins over `every` and the first-slot default. */
  readonly when?: (index: number, count: number) => boolean;
}

export interface FormatSection {
  readonly key: string;
  readonly role: SlotRole;
  /** Slot count; `pref` may depend on the target. Ignored for the fill section. */
  readonly count: { readonly min: number; readonly pref: (seconds: number) => number; readonly max: number };
  readonly beats: SectionBeats;
  /** Takes whatever time is left. One per format. */
  readonly fill?: true;
  /** Dropped first when the target is too short for every section. */
  readonly optional?: true;
  /** The slot's intent: `index` within the section, `count` slots in it. */
  intent(index: number, count: number): IntentSeed;
  /** A placeholder overlay. Without `every` or `when`, only the section's first slot. */
  readonly label?: SectionLabel;
  readonly labels?: readonly SectionLabel[];
  /** Written on each of the section's slots (highlight reel slow-down: 1 → 0.5 → 1). */
  readonly speedRamp?: { readonly from: number; readonly mid: number; readonly to: number };
  /** Whip into this section's first slot. Never on the format's first section. */
  readonly transitionIn?: { readonly kind: 'whip' };
  /**
   * Fill only. After the fill is sized to N slots, N − 1 slots of `between`
   * are inserted between them and spend beats from the same budget.
   */
  readonly between?: FormatSection;
}

export interface FormatModule {
  readonly id: FormatId;
  readonly version: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly defaultBpm: number;
  readonly audio: 'music' | 'voice';
  readonly captions: 'optional' | 'recommended' | 'required';
  readonly sections: readonly FormatSection[];
  readonly constraints?: readonly AllocationConstraint[];
}

/** A module before its checks: the id is still any string (defineFormat and the registry refuse unknown ones). */
export type FormatModuleDraft = Omit<FormatModule, 'id'> & { readonly id: string };

export function isFormatId(id: string): id is FormatId {
  return (FORMAT_IDS as readonly string[]).includes(id);
}

/** A section's placeholder overlays: `label`, then `labels`. */
export function labelsOf(section: FormatSection): readonly SectionLabel[] {
  return [...(section.label ? [section.label] : []), ...(section.labels ?? [])];
}

function sectionProblem(section: FormatSection, keys: Set<string>, fillKeys: string[]): string | null {
  if (keys.has(section.key)) return `Duplicate section ${section.key}`;
  keys.add(section.key);
  if (section.count.min > section.count.max) return `${section.key} has count min > max`;
  if (typeof section.beats !== 'string' && section.beats.min > section.beats.max)
    return `${section.key} has beats min > max`;
  if (section.fill) fillKeys.push(section.key);
  for (const label of labelsOf(section)) {
    if (!isPlaceholderText(label.text)) return `${section.key} placeholder ${label.text} is not registered`;
    if (label.box && !boxFitsSafe(label.box)) return `${section.key} text box is outside the safe rect`;
  }
  const ramp = section.speedRamp;
  if (ramp && [ramp.from, ramp.mid, ramp.to].some((speed) => !(speed >= 0.1 && speed <= 16)))
    return `${section.key} speed ramp is outside 0.1–16`;
  if (!section.between) return null;
  if (!section.fill) return `${section.key} puts between on a fixed section`;
  if (section.between.fill || section.between.between)
    return `${section.key} between section is not a single insert`;
  return sectionProblem(section.between, keys, []);
}

/** Refuses a module whose sections cannot be planned. The id itself is the registry's check too. */
export function defineFormat(input: FormatModuleDraft): Result<FormatModule> {
  const problem = (detail: string): Result<FormatModule> =>
    err(ValidationError({ field: 'format' }, { detail }));
  if (!isFormatId(input.id)) return problem(`Unknown format ${input.id}`);
  if (input.version.trim().length === 0) return problem('Format version is empty');
  if (input.nameKey.trim().length === 0 || input.descriptionKey.trim().length === 0)
    return problem('Format name keys are empty');
  if (
    !Number.isInteger(input.minSeconds) ||
    !Number.isInteger(input.maxSeconds) ||
    input.minSeconds > input.maxSeconds
  )
    return problem('Format length bounds are invalid');
  if (!Number.isInteger(input.defaultBpm) || input.defaultBpm < 80 || input.defaultBpm > 180)
    return problem(`defaultBpm ${input.defaultBpm} is outside 80–180`);
  const first = input.sections[0];
  if (first?.transitionIn) return problem('The first section cannot transition in');
  const fillKeys: string[] = [];
  const keys = new Set<string>();
  for (const section of input.sections) {
    const found = sectionProblem(section, keys, fillKeys);
    if (found) return problem(found);
  }
  if (fillKeys.length !== 1) return problem(`Format ${input.id} needs exactly one fill section`);
  return ok({
    id: input.id,
    version: input.version,
    nameKey: input.nameKey,
    descriptionKey: input.descriptionKey,
    minSeconds: input.minSeconds,
    maxSeconds: input.maxSeconds,
    defaultBpm: input.defaultBpm,
    audio: input.audio,
    captions: input.captions,
    sections: input.sections,
    ...(input.constraints ? { constraints: input.constraints } : {}),
  });
}

/** A catalog module that failed its own checks is a build bug, not a plan the user can fix. */
export function defined(result: Result<FormatModule>): FormatModule {
  if (result.ok) return result.value;
  throw new Error(result.error.detail ?? result.error.code);
}
