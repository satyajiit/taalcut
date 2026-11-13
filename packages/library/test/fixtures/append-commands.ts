// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the durability test. Appends commands to the audit log in
 * a tight loop and acknowledges each one on stdout only after append()
 * returned, i.e. after its transaction committed. The parent kill -9s it.
 *
 *   node --import tsx append-commands.ts <db path>
 */
import { writeSync } from 'node:fs';
import { newId, unwrap } from '@taalcut/core';
import { createAuditLogRepository, openDatabase } from '../../src/index';

/** Synchronous write to fd 1, so an acknowledgement is never sitting in a JS buffer when the process dies. */
function acknowledge(line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(1, bytes, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
    }
  }
}

const db = unwrap(openDatabase({ path: process.argv[2]! }));
const auditLog = createAuditLogRepository(db);
acknowledge('ready');

for (let i = 0; ; i++) {
  const entry = unwrap(
    auditLog.append({
      id: newId<'Command'>(),
      projectId: null,
      name: 'test.burst',
      payload: { i, pad: 'x'.repeat(i % 200) },
      inverse: { name: 'test.burst', payload: { i } },
      source: 'agent',
      actor: `pid:${process.pid}`,
      sideEffect: 'write',
      createdAt: Date.now(),
      idempotencyKey: null,
      result: null,
    }),
  );
  acknowledge(`ack ${entry.id} ${entry.sequence}`);
}
