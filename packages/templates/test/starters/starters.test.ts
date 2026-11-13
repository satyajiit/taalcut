// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shipped starters (P3-B3, P3-L2): hub documents, locale lists, addStarter undo. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_LOCALES,
  hubContentProblems,
  hubTemplateV0Schema,
  newId,
  NotFoundError,
  TEMPLATE_COMMANDS,
  ValidationError,
  type AppLocale,
  type HubTemplateV0,
} from '@taalcut/core';
import { FORMAT_BPM } from '../../src/formats/plan-format';
import { fromHubTemplate } from '../../src/hub/from-hub';
import { STARTER_CATALOGUE } from '../../src/starters/catalogue';
import { STARTER_MANIFEST } from '../../src/starters/manifest';
import { createStarterCommands } from '../../src/starters/starter-commands';
import {
  createStarterCatalogue,
  loadStarter,
  readStarterDocument,
  starterSummaries,
} from '../../src/starters/starter-service';
import type { StarterEntry } from '../../src/starters/manifest-schema';
import { countingIds } from '../formats/helpers';
import { setupTemplates, UI } from '../helpers/setup';

const ROOT = fileURLToPath(new URL('../../starters/', import.meta.url));
const N = TEMPLATE_COMMANDS;
const GLOBAL = [
  'weekend-trip',
  'my-day',
  'quick-tip',
  'product-in-30-seconds',
  'glow-up',
  'best-moments',
] as const;

const BY_LOCALE: Record<AppLocale, readonly string[]> = {
  en: [...GLOBAL, 'recipe-in-30-seconds', 'podcast-moment'],
  hi: [...GLOBAL, 'festival-vlog', 'wedding-highlights'],
  es: [...GLOBAL, 'receta-rapida', 'golazos'],
  'pt-BR': [...GLOBAL, 'role-de-fim-de-semana', 'receita-rapida'],
};

async function listed(locale: AppLocale, forLibrary = false) {
  const page = await createStarterCatalogue().starters({ locale, forLibrary });
  expect(page.ok, page.ok ? '' : page.error.code).toBe(true);
  if (!page.ok) throw new Error(page.error.code);
  return page.value;
}

describe('starter documents', () => {
  it('every manifest file passes the hub schema, content rules and fromHubTemplate', async () => {
    expect(STARTER_MANIFEST).toHaveLength(STARTER_CATALOGUE.length);
    for (const entry of STARTER_MANIFEST) {
      const spec = STARTER_CATALOGUE.find((row) => row.id === entry.id);
      expect(spec, entry.id).toBeDefined();
      if (!spec) continue;
      const text = await readFile(`${ROOT}${entry.file}`, 'utf8');
      const raw: unknown = JSON.parse(text);
      const parsed = hubTemplateV0Schema.safeParse(raw);
      expect(parsed.success, entry.id).toBe(true);
      expect(hubContentProblems(raw), entry.id).toEqual([]);
      if (!parsed.success) continue;
      const doc: HubTemplateV0 = parsed.data;
      const forked = fromHubTemplate(doc, countingIds(), 5);
      expect(forked.ok, forked.ok ? '' : forked.error.detail).toBe(true);
      expect(doc.structure.duration.value).toBe(spec.seconds * 30);
      expect(doc.structure.beatMap?.bpm).toBe(spec.bpm ?? FORMAT_BPM.default);
      expect(entry.formatId).toBe(spec.formatId);
      expect(entry.needs).toBe(spec.needs);
      expect(entry.order).toBe(STARTER_CATALOGUE.indexOf(spec));
      expect(entry.nameKey).toBe(`starters.${entry.id}.name`);
      expect(entry.descriptionKey).toBe(`starters.${entry.id}.description`);
      expect(entry.nameKey).not.toMatch(/\s/);
      expect(entry.locales).toEqual(spec.locales === 'all' ? 'all' : [...spec.locales]);
    }
  });

  it('gives each locale its six global starters plus two of its own, in catalogue order', async () => {
    for (const locale of APP_LOCALES) {
      const items = await listed(locale);
      expect(items.length).toBeGreaterThanOrEqual(6);
      expect(items.length).toBeLessThanOrEqual(10);
      expect(items.map((item) => item.starterId)).toEqual(BY_LOCALE[locale]);
      expect(items.every((item) => item.nameKey === `starters.${item.starterId}.name`)).toBe(true);
      expect(items.every((item) => item.structure.slots.length > 0)).toBe(true);
    }
    const library = await listed('en', true);
    const plain = await listed('en', false);
    expect(library.map((item) => item.starterId)).toEqual(plain.map((item) => item.starterId));
  });

  it('omits a file that fails to read, says so, and keeps the rest', async () => {
    const log = vi.fn<(line: string) => void>();
    const items = await starterSummaries(
      { locale: 'en', forLibrary: false },
      STARTER_MANIFEST,
      async (entry) => {
        if (entry.id === 'glow-up') return readStarterDocument('{');
        return loadStarter(entry);
      },
      log,
    );
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.starterId)).not.toContain('glow-up');
    expect(log).toHaveBeenCalledWith('[templates] starter glow-up omitted: core.validation');
  });

  it('refuses text that is not a hub document and a file name that leaves the directory', async () => {
    const text = readStarterDocument('{');
    expect(text.ok).toBe(false);
    if (!text.ok) {
      expect(ValidationError.is(text.error)).toBe(true);
      expect(text.error.params?.field).toBe('file');
    }
    const outside: StarterEntry = {
      id: 'weekend-trip',
      file: '../manifest.json',
      formatId: 'vlog',
      locales: 'all',
      nameKey: 'starters.weekend-trip.name',
      descriptionKey: 'starters.weekend-trip.description',
      order: 0,
      needs: 'many-clips',
    };
    const loaded = await loadStarter(outside);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.params?.field).toBe('file');
  });
});

describe('template.addStarter', () => {
  it('forks a starter and one undo removes it; redo creates it again', async () => {
    const { bus, store, clock } = setupTemplates();
    bus.register(...createStarterCommands({ store, clock, libraryMetadata: true }).all);
    const templateId = newId<'Template'>();
    const added = await bus.dispatch(
      N.addStarter,
      { projectId: null, starterId: 'festival-vlog', templateId },
      UI,
    );
    expect(added.ok && added.value.result).toEqual({ templateId, version: 1 });
    const head = await store.get(templateId);
    expect(head.ok && head.value.summary).toMatchObject({
      name: 'festival-vlog',
      listed: true,
      projectId: null,
      provenance: { kind: 'starter', starterId: 'festival-vlog', locale: 'hi' },
    });

    const weekendId = newId<'Template'>();
    const weekend = await bus.dispatch(
      N.addStarter,
      { projectId: null, starterId: 'weekend-trip', templateId: weekendId },
      UI,
    );
    expect(weekend.ok).toBe(true);
    const weekendHead = await store.get(weekendId);
    expect(weekendHead.ok && weekendHead.value.summary.provenance).toEqual({
      kind: 'starter',
      starterId: 'weekend-trip',
      locale: 'en',
    });

    expect((await bus.undo(null, UI)).ok).toBe(true);
    const removed = await store.get(weekendId);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(NotFoundError.is(removed.error)).toBe(true);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const restored = await store.get(weekendId);
    expect(restored.ok && restored.value.summary.provenance).toEqual({
      kind: 'starter',
      starterId: 'weekend-trip',
      locale: 'en',
    });
  });

  it('refuses an unknown starter id', async () => {
    const { bus, store, clock } = setupTemplates();
    bus.register(...createStarterCommands({ store, clock, libraryMetadata: true }).all);
    const templateId = newId<'Template'>();
    const added = await bus.dispatch(N.addStarter, { projectId: null, starterId: 'nope', templateId }, UI);
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.error.code).toBe('templates.starter_not_found');
    const missing = await store.get(templateId);
    expect(missing.ok).toBe(false);
  });
});
