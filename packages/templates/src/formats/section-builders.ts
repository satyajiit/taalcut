// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CameraMotion, ShotType } from '@taalcut/core';
import type { FormatSection, IntentSeed, SectionLabel } from './format-module';

export const one: FormatSection['count'] = { min: 1, pref: () => 1, max: 1 };
export const fillCount: FormatSection['count'] = { min: 0, pref: () => 0, max: 0 };

export const ramp = (from: number, to: number, index: number, count: number): number =>
  Math.round((count <= 1 ? from : from + ((to - from) * index) / (count - 1)) * 100) / 100;

export function turn<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value !== undefined) return value;
  throw new Error('turn() needs a value');
}

export interface HookOverrides {
  readonly text?: string;
  readonly energy?: number;
  readonly shotType?: ShotType | null;
  readonly motion?: CameraMotion | null;
  readonly people?: number | null;
}

/** The shared hook. With no overrides the P2 line and energy 0.9 are unchanged. */
export function hook(subject: string, overrides: HookOverrides = {}): FormatSection {
  return {
    key: 'hook',
    role: 'hook',
    count: one,
    beats: 'hook',
    intent: () => ({
      text: overrides.text ?? `Hook: ${subject}, movement or a face, grabbing attention in the first second`,
      shotType: overrides.shotType ?? null,
      motion: overrides.motion ?? null,
      subject,
      people: overrides.people ?? null,
      energy: overrides.energy ?? 0.9,
    }),
  };
}

/** A body part with a `{time}` label, as day-in-the-life uses it. */
export function part(
  key: string,
  count: FormatSection['count'],
  intent: FormatSection['intent'],
  optional = false,
): FormatSection {
  return {
    key,
    role: 'body',
    count,
    beats: 'body',
    label: { text: '{time}', role: 'label' },
    intent,
    ...(optional ? { optional: true as const } : {}),
  };
}

export interface SectionDraft {
  readonly key: string;
  readonly role: FormatSection['role'];
  readonly count: FormatSection['count'];
  readonly beats: FormatSection['beats'];
  readonly fill?: true;
  readonly optional?: true;
  readonly intent: FormatSection['intent'];
  readonly label?: SectionLabel;
  readonly labels?: readonly SectionLabel[];
  readonly speedRamp?: FormatSection['speedRamp'];
  readonly transitionIn?: FormatSection['transitionIn'];
  readonly between?: FormatSection;
}

export function section(draft: SectionDraft): FormatSection {
  return {
    key: draft.key,
    role: draft.role,
    count: draft.count,
    beats: draft.beats,
    intent: draft.intent,
    ...(draft.fill ? { fill: true as const } : {}),
    ...(draft.optional ? { optional: true as const } : {}),
    ...(draft.label ? { label: draft.label } : {}),
    ...(draft.labels ? { labels: draft.labels } : {}),
    ...(draft.speedRamp ? { speedRamp: draft.speedRamp } : {}),
    ...(draft.transitionIn ? { transitionIn: draft.transitionIn } : {}),
    ...(draft.between ? { between: draft.between } : {}),
  };
}

export type { IntentSeed };
