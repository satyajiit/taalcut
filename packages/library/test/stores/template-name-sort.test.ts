// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B1 (hardening): the template list's name sort knows Unicode (migration 24, stores/template-name-key.ts).
 * Accented Latin sorts with its base letter and case doesn't matter; Hindi keeps its vowel signs; a rename moves
 * the template; every page of a keyset-paged name sort joins up to the one-page answer.
 */
import { join } from 'node:path';
import { unwrap, type TemplateListQuery } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateStore } from '../../src/index';
import { TEMPLATE_NAME_KEY_MAX, templateNameKey } from '../../src/stores/template-name-key';
import { openTestDb, tempDir } from '../helpers';
import { template } from './documents';

const base = { includeUnlisted: false, includeArchived: false, limit: 50 } as const;

async function setup(names: readonly string[]) {
  const store = createTemplateStore(openTestDb({ file: false }), { assetsDir: join(tempDir(), 'assets') });
  for (const name of names) unwrap(await store.create(template(), { name, projectId: null, listed: true }));
  const list = async (query: Partial<TemplateListQuery>) =>
    unwrap(await store.list({ ...base, ...query })).items.map((item) => item.name);
  const paged = async (query: Partial<TemplateListQuery>) => {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = unwrap(await store.list({ ...base, ...query, limit: 2, cursor }));
      out.push(...page.items.map((item) => item.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  };
  return { store, list, paged };
}

describe('template name sort (Unicode)', () => {
  it('sorts accented Latin with its base letter, without case, and Hindi after Latin', async () => {
    const { list, paged } = await setup([
      'zebra',
      'Árbol',
      'ग्राम',
      'Éclair',
      'apple',
      'ÁRBOLES',
      'banana',
      'कमल',
    ]);
    const asc = ['apple', 'Árbol', 'ÁRBOLES', 'banana', 'Éclair', 'zebra', 'कमल', 'ग्राम'];
    expect(await list({ sort: 'name', dir: 'asc' })).toEqual(asc);
    expect(await list({ sort: 'name', dir: 'desc' })).toEqual([...asc].reverse());
    expect(await paged({ sort: 'name', dir: 'asc' })).toEqual(asc);
    expect(await paged({ sort: 'name', dir: 'desc' })).toEqual([...asc].reverse());
  });

  it('pages through names that share a key by id', async () => {
    const { list, paged } = await setup(['Árbol', 'arbol', 'ARBOL', 'Arból', 'apple']);
    const all = await list({ sort: 'name', dir: 'asc' });
    expect(all[0]).toBe('apple');
    expect(all.slice(1).sort()).toEqual(['ARBOL', 'Arból', 'arbol', 'Árbol'].sort());
    expect(await paged({ sort: 'name', dir: 'asc' })).toEqual(all);
  });

  it('moves a renamed template', async () => {
    const { store, list } = await setup(['banana']);
    const cherry = template();
    unwrap(await store.create(cherry, { name: 'cherry', projectId: null, listed: true }));
    unwrap(await store.setMeta(cherry.id, { name: 'Ábaco' }));
    expect(await list({ sort: 'name', dir: 'asc' })).toEqual(['Ábaco', 'banana']);
  });
});

describe('templateNameKey', () => {
  it('drops Latin accents and case but keeps Devanagari vowel signs, virama and nukta', () => {
    expect(templateNameKey('Árbol')).toBe('arbol');
    expect(templateNameKey('ÉCLAIR')).toBe('eclair');
    expect(templateNameKey('ﬁesta')).toBe('fiesta');
    expect(templateNameKey('कि')).toBe('कि');
    expect(templateNameKey('ग्राम')).toBe('ग्राम');
    // क़ decomposes to क and the nukta, which stays.
    expect(templateNameKey('क़')).toBe('क़');
  });

  it('cuts a key that grows past the limit on a code point boundary', () => {
    const emoji = templateNameKey(`a${'😀'.repeat(119)}`);
    expect(emoji.length).toBeLessThanOrEqual(TEMPLATE_NAME_KEY_MAX);
    expect(emoji).toBe(`a${'😀'.repeat(99)}`);
    // U+FDFA expands to 18 characters under NFKD.
    const long = templateNameKey('ﷺ'.repeat(20));
    expect(long.length).toBe(TEMPLATE_NAME_KEY_MAX);
  });
});
