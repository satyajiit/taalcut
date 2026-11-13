// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The formats this build offers, as /templates and the brief path list them. */
import { err, ok, ValidationError, type FormatSummary, type Result } from '@taalcut/core';
import { FORMAT_MODULES } from './catalog';
import type { AllocationConstraint } from './constraints/types';
import { isFormatId, type FormatModule, type FormatModuleDraft, type FormatSection } from './format-module';

export interface FormatDefinition {
  readonly summary: FormatSummary;
  readonly sections: readonly FormatSection[];
  readonly constraints: readonly AllocationConstraint[];
}

export interface FormatRegistry {
  get(id: string): Result<FormatDefinition>;
  list(): readonly FormatDefinition[];
  readonly summaries: readonly FormatSummary[];
}

function definitionOf(module: FormatModule): FormatDefinition {
  return {
    summary: {
      id: module.id,
      version: module.version,
      nameKey: module.nameKey,
      descriptionKey: module.descriptionKey,
      minSeconds: module.minSeconds,
      maxSeconds: module.maxSeconds,
      defaultBpm: module.defaultBpm,
      audio: module.audio,
      captions: module.captions,
    },
    sections: module.sections,
    constraints: module.constraints ?? [],
  };
}

/** Refuses a duplicate id and any id outside core's FORMAT_IDS. Missing ids are the catalog test's job. */
export function createFormatRegistry(modules: readonly FormatModuleDraft[]): Result<FormatRegistry> {
  const byId = new Map<string, FormatDefinition>();
  for (const module of modules) {
    if (!isFormatId(module.id))
      return err(ValidationError({ field: 'formatId' }, { detail: `Unknown format ${module.id}` }));
    if (byId.has(module.id))
      return err(ValidationError({ field: 'formatId' }, { detail: `Duplicate format ${module.id}` }));
    byId.set(module.id, definitionOf({ ...module, id: module.id }));
  }
  const list = [...byId.values()];
  return ok({
    get(id: string): Result<FormatDefinition> {
      const found = byId.get(id);
      return found
        ? ok(found)
        : err(ValidationError({ field: 'formatId' }, { detail: `Unknown format ${id}` }));
    },
    list: () => list,
    summaries: list.map((definition) => definition.summary),
  });
}

function registryOf(modules: readonly FormatModule[]): FormatRegistry {
  const created = createFormatRegistry(modules);
  if (created.ok) return created.value;
  throw new Error(created.error.detail ?? created.error.code);
}

export const FORMAT_REGISTRY: FormatRegistry = registryOf(FORMAT_MODULES);

export const FORMAT_SUMMARIES: readonly FormatSummary[] = FORMAT_REGISTRY.summaries;

export function getFormat(id: string): Result<FormatDefinition> {
  return FORMAT_REGISTRY.get(id);
}
