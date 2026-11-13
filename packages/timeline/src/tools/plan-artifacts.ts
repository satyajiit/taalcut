// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Plans the read tools make (cleanup, energy curve) kept as JSON artifacts, so the model applies a plan by its id
 * and never copies the plan back; the apply tool reads it again and checks it with the plan's own schema.
 */
import {
  err,
  ok,
  ValidationError,
  type ArtifactId,
  type ArtifactRef,
  type ArtifactStore,
  type AsyncResult,
} from '@taalcut/core';
import type { z } from 'zod';
import { parseField } from './parse-field';

export function storePlan(
  artifacts: ArtifactStore,
  plan: unknown,
  summary: string,
): AsyncResult<ArtifactRef> {
  return artifacts.put({ mediaType: 'application/json', data: JSON.stringify(plan), summary });
}

/** A kept plan as it was written (`raw`) and as its schema reads it (`value`). */
export interface ReadPlan<T> {
  readonly raw: unknown;
  readonly value: T;
}

/** The stored plan as it was written (`raw`) and checked against `schema` (`value`); `core.validation` on `plan`. */
export async function readPlan<S extends z.ZodType>(
  artifacts: ArtifactStore,
  id: ArtifactId,
  schema: S,
): AsyncResult<ReadPlan<z.output<S>>> {
  const stored = await artifacts.get(id);
  if (!stored.ok) return stored;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(stored.value.data));
  } catch (cause) {
    return err(
      ValidationError({ field: 'plan' }, { detail: cause instanceof Error ? cause.message : 'not JSON' }),
    );
  }
  const value = parseField(schema, raw, 'plan');
  return value.ok ? ok({ raw, value: value.value }) : value;
}
