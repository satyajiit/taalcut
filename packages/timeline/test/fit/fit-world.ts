// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A world for fit tests: templates in the memory template store, their vectors in a memory template index written
 * by templates' own writer, and a pool of shot profiles behind the memory catalogue (its `list` and `recent` are
 * the profile source's). Intents and shots share known vectors, so "matches" is by construction.
 */
import { createManualClock, ok, type ShotProfile, type Template } from '@taalcut/core';
import { createTemplateVectors } from '@taalcut/templates';
import { createMemoryTemplateStore, createMemoryVectorIndex } from '@taalcut/templates/test-support';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createTemplateFitter } from '../../src/fit/fit-templates';
import { DIMS, fakeEmbedder, makeProfile, near, unitVector, type ProfileDef } from '../fixtures/library';
import { buildTemplate, type TemplateDef } from '../fixtures/template';

/** Named directions: an intent and the shots that match it share one. */
export const THEMES = ['beach', 'market', 'coffee', 'street', 'mountain', 'party'] as const;
export type Theme = (typeof THEMES)[number];
export const direction = (theme: Theme) => unitVector(100 + THEMES.indexOf(theme));

export const embedder = () =>
  fakeEmbedder(new Map(THEMES.map((theme) => [theme, direction(theme)] as [string, Float32Array])));

/** A template whose slots want these themes (each slot 30 frames). */
export const themed = (themes: readonly Theme[], extra: Partial<TemplateDef> = {}): Template =>
  buildTemplate({ slots: themes.map((text) => ({ frames: 30, text })), ...extra });

/** A shot close to a theme. */
export const shot = (theme: Theme, seed: number, def: Partial<ProfileDef> = {}): ShotProfile =>
  makeProfile({ embedding: near(direction(theme), seed, 0.15), ...def });

export async function fitWorld(
  templates: readonly { template: Template; name?: string; listed?: boolean }[],
  pool: readonly ShotProfile[],
) {
  const clock = createManualClock(10);
  const store = createMemoryTemplateStore(clock);
  for (const [index, entry] of templates.entries()) {
    const created = await store.create(entry.template, {
      name: entry.name ?? `Template ${index + 1}`,
      projectId: null,
      listed: entry.listed ?? true,
    });
    if (!created.ok) throw new Error(created.error.code);
  }
  const index = createMemoryVectorIndex('fake_test_tpl', DIMS);
  const vectors = createTemplateVectors({ index, embedder: embedder(), store });
  const catalog = createMemoryShotCatalog(pool);
  const fitter = createTemplateFitter({
    profiles: catalog,
    templates: store,
    vectors: async () => ok(vectors),
  });
  return { store, index, vectors, catalog, fitter };
}

/** The list's item at `index`; a test fails here when it is missing. */
export function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${index} of ${list.length}`);
  return item;
}
