// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 review M2: `library.importStock` committed its download job and its import record before the audit
 * row, so a kill before the append left a queued download the undo stack never saw. Both are staged on the
 * command's unit of work now and commit with the audit row, or not at all.
 */
import {
  createCommandBus,
  err,
  LIBRARY_COMMANDS,
  newId,
  systemClock,
  toTaalcutError,
  unwrap,
  type AuditLogStore,
  type CommandContext,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createCommandUnitOfWork,
  createJobRepository,
  createSqliteStockCache,
  createStockCommands,
  stockImportJob,
  type StockCache,
  type StockHttp,
} from '../../src/index';
import type { LibraryDatabase } from '../../src/db/database';
import { enqueueInTransaction } from '../../src/sources/enqueue';
import { readImportRecord } from '../../src/stock/stock-import';
import { openTestDb } from '../helpers';
import { seedPexelsClip } from './fixtures';

const NOW = Date.UTC(2026, 9, 12);
const ITEM = { provider: 'pexels' as const, providerId: '101', kind: 'video' as const, renditionKey: '15' };
const ui: CommandOrigin = { source: 'ui', actor: 'user' };

/** Never called: the command only checks that a download could run. */
const http: StockHttp = {
  get: async () => {
    throw new Error('no request expected');
  },
  stream: async () => {
    throw new Error('no request expected');
  },
};

const seed = (cache: StockCache) => seedPexelsClip(cache, NOW, 'https://videos.pexels.com/101.mp4');

const stockJobs = (db: LibraryDatabase) =>
  db.driver.prepare('SELECT id, state FROM jobs WHERE kind = ?').all(stockImportJob.kind) as {
    id: string;
    state: string;
  }[];

function setup(store?: (auditLog: AuditLogStore) => AuditLogStore) {
  const db = openTestDb({ file: false });
  const cache = createSqliteStockCache(db);
  seed(cache);
  const uow = createCommandUnitOfWork(db);
  const commands = createStockCommands(db, { cache, clock: () => NOW, http, commands: uow });
  const bus = createCommandBus({ store: store ? store(uow.auditLog) : uow.auditLog, clock: systemClock });
  bus.register(commands.importStock, commands.discardStockImport);
  const importId = newId<'StockImport'>();
  const record = () => readImportRecord(cache, importId, NOW);
  const audit = () => db.driver.prepare('SELECT name FROM commands').all() as { name: string }[];
  return { db, uow, commands, bus, importId, record, audit };
}

describe('library.importStock commits its job with the audit row (M2)', () => {
  it('writes the job, the import record and the audit row together', async () => {
    const { db, bus, importId, record, audit } = setup();
    const done = unwrap(await bus.dispatch(LIBRARY_COMMANDS.importStock, { importId, item: ITEM }, ui));
    const { jobId } = done.result as { jobId: string };
    expect(stockJobs(db)).toEqual([{ id: jobId, state: 'queued' }]);
    expect(record()).toMatchObject({ importId, jobId, assetId: null });
    expect(audit()).toEqual([{ name: LIBRARY_COMMANDS.importStock }]);
  });

  it('leaves no queued download and no record when the process dies before the append', async () => {
    const { db, commands, importId, record, audit } = setup();
    const context: CommandContext = { ...ui, commandId: newId<'Command'>(), projectId: null };
    // The handler returns; the kill comes before the bus appends, so the staged writes never run.
    const handled = unwrap(
      await commands.importStock.handle({ importId, item: ITEM, projectId: null }, context),
    );
    expect(handled.result.jobId).not.toBeNull();
    expect(stockJobs(db)).toEqual([]);
    expect(record()).toBeNull();
    expect(audit()).toEqual([]);
  });

  it('leaves nothing when the store refuses the append', async () => {
    const { db, bus, importId, record, audit } = setup((auditLog) => ({
      ...auditLog,
      append: async () => err(toTaalcutError(new Error('disk full'))),
    }));
    const refused = await bus.dispatch(LIBRARY_COMMANDS.importStock, { importId, item: ITEM }, ui);
    expect(refused.ok).toBe(false);
    expect(stockJobs(db)).toEqual([]);
    expect(record()).toBeNull();
    expect(audit()).toEqual([]);
  });

  it('rolls the whole command back when another import queued the item meanwhile', async () => {
    const { db, uow, commands, importId, record, audit } = setup();
    const context: CommandContext = { ...ui, commandId: newId<'Command'>(), projectId: null };
    const handled = unwrap(
      await commands.importStock.handle({ importId, item: ITEM, projectId: null }, context),
    );
    const other = unwrap(
      enqueueInTransaction(db, {
        kind: stockImportJob,
        input: {
          importId: newId<'StockImport'>(),
          item: ITEM,
          projectId: null,
          url: 'https://videos.pexels.com/101.mp4',
          licence: 'Pexels-Licence',
          rawLicence: 'Pexels-Licence',
          author: 'Ada',
          authorUrl: null,
          sourceUrl: 'https://www.pexels.com/video/101/',
          title: 'Waves',
          attribution: '',
        },
      }),
    );
    const appended = await uow.auditLog.append({
      id: context.commandId,
      projectId: null,
      name: LIBRARY_COMMANDS.importStock,
      payload: { importId, item: ITEM, projectId: null },
      inverse: handled.inverse ?? null,
      source: 'ui',
      actor: 'user',
      sideEffect: 'write',
      createdAt: NOW,
      idempotencyKey: null,
      result: handled.result,
    });
    expect(!appended.ok && appended.error.code).toBe('core.conflict');
    expect(stockJobs(db)).toEqual([{ id: other.job.id, state: 'queued' }]);
    expect(record()).toBeNull();
    expect(audit()).toEqual([]);
  });

  it('names a download already queued for the item, and the job runs once', async () => {
    const { db, bus, importId } = setup();
    const first = unwrap(await bus.dispatch(LIBRARY_COMMANDS.importStock, { importId, item: ITEM }, ui));
    const second = unwrap(
      await bus.dispatch(LIBRARY_COMMANDS.importStock, { importId: newId<'StockImport'>(), item: ITEM }, ui),
    );
    expect((second.result as { jobId: string }).jobId).toBe((first.result as { jobId: string }).jobId);
    expect(stockJobs(db)).toHaveLength(1);
    expect(unwrap(createJobRepository(db).get((first.result as { jobId: never }).jobId)).state).toBe(
      'queued',
    );
  });
});
