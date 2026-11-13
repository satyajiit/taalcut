// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SlotRole } from '../../types';

/** The section fields a constraint may read. Kept off `format-module` so the two files do not import each other. */
export interface ConstrainedSection {
  readonly key: string;
  readonly role: SlotRole;
  readonly fill?: true;
  readonly optional?: true;
  readonly count: { readonly min: number; readonly max: number };
}

export interface AllocatedPart {
  readonly section: ConstrainedSection;
  readonly range: { readonly min: number; readonly pref: number; readonly max: number };
  lengths: number[];
}

/**
 * Applied after the allocator's shrink order. `enforce` may move beats between
 * parts; it returns false when the plan cannot satisfy the constraint.
 */
export interface AllocationConstraint {
  readonly name: string;
  /** Shrink drops these two sections' slots together. */
  readonly paired?: readonly [string, string];
  enforce(parts: readonly AllocatedPart[], units: number): boolean;
}
