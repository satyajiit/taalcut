// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Local only as stock reads it: an unreadable setting keeps the network closed (P3-V18). */
import { LOCAL_ONLY_SETTING, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createMemoryStockCache,
  createSettingsRepository,
  createStockCommands,
  readLocalOnly,
  type StockHttp,
} from '../../src/index';
import { openTestDb } from '../helpers';

const ITEM = { provider: 'pexels' as const, providerId: '101', kind: 'video' as const, renditionKey: '15' };

describe('readLocalOnly', () => {
  it('is the default when unset, the stored value when valid, and on when unreadable', () => {
    const db = openTestDb({ file: false });
    const settings = createSettingsRepository(db);
    expect(readLocalOnly(db)).toBe(LOCAL_ONLY_SETTING.defaultValue);
    unwrap(settings.set(LOCAL_ONLY_SETTING.key, true));
    expect(readLocalOnly(db)).toBe(true);
    unwrap(settings.set(LOCAL_ONLY_SETTING.key, false));
    expect(readLocalOnly(db)).toBe(false);
    unwrap(settings.set(LOCAL_ONLY_SETTING.key, 'yes'));
    expect(readLocalOnly(db)).toBe(true);
  });

  it('makes the import command refuse an unreadable setting before any request', async () => {
    const db = openTestDb({ file: false });
    unwrap(createSettingsRepository(db).set(LOCAL_ONLY_SETTING.key, 'yes'));
    let requests = 0;
    const http: StockHttp = {
      get: async () => {
        requests += 1;
        throw new Error('no request expected');
      },
      stream: async () => {
        requests += 1;
        throw new Error('no request expected');
      },
    };
    const commands = createStockCommands(db, { cache: createMemoryStockCache(), http });
    const refused = await commands.importStock.handle(
      { importId: newId<'StockImport'>(), item: ITEM, projectId: null },
      { source: 'ui', actor: 'user', commandId: newId<'Command'>(), projectId: null },
    );
    expect(!refused.ok && refused.error.code).toBe('core.local_only');
    expect(requests).toBe(0);
  });
});
