// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  productOccurrenceSchema,
  productScheduleSchema,
  ValidationError,
  type ProductOccurrence,
  type ProductSchedule,
  type ProductStore,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { inTransaction, pageSize } from '../repositories/shared';
import { stagedWriter } from '../stores/staged-write';
import { productRow, productRows } from './rows';

type ScheduleMethods = Pick<
  ProductStore,
  | 'listSchedules'
  | 'getSchedule'
  | 'getOccurrence'
  | 'listDue'
  | 'saveSchedule'
  | 'claimOccurrence'
  | 'expiredOccurrences'
  | 'settleOccurrence'
>;
export function productScheduleStore(db: LibraryDatabase, commands?: CommandStager): ScheduleMethods {
  const write = stagedWriter(db, commands, 'productSchedule');
  const scheduleRow = (id: string) =>
    db.driver.prepare('SELECT * FROM product_schedules WHERE product_id=?').get(id);
  function save(schedule: ProductSchedule) {
    db.driver
      .prepare(
        `INSERT INTO product_schedules(product_id,revision,enabled,next_run_at,body_json) VALUES(?,?,?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,
      next_run_at=excluded.next_run_at,body_json=excluded.body_json`,
      )
      .run(
        schedule.productId,
        schedule.revision,
        Number(schedule.enabled),
        schedule.nextRunAt,
        JSON.stringify(schedule),
      );
  }
  function putOccurrence(occurrence: ProductOccurrence) {
    db.driver
      .prepare(
        `INSERT INTO product_occurrences(id,product_id,scheduled_for,state,lease_until,body_json) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,lease_until=excluded.lease_until,body_json=excluded.body_json`,
      )
      .run(
        occurrence.id,
        occurrence.productId,
        occurrence.scheduledFor,
        occurrence.state,
        occurrence.leaseUntil,
        JSON.stringify(occurrence),
      );
  }
  return {
    async getOccurrence(id) {
      const row = db.driver.prepare('SELECT body_json FROM product_occurrences WHERE id=?').get(id);
      return row
        ? productRow(row, productOccurrenceSchema)
        : err(NotFoundError({ entity: 'productOccurrence', id }));
    },
    async getSchedule(productId) {
      const row = scheduleRow(productId);
      return row ? productRow(row, productScheduleSchema) : ok(null);
    },
    async listSchedules() {
      return productRows(
        db.driver
          .prepare(
            `SELECT s.body_json FROM product_schedules s JOIN products p ON p.id=s.product_id
        WHERE p.archived_at IS NULL ORDER BY s.next_run_at,s.product_id`,
          )
          .all(),
        productScheduleSchema,
      );
    },
    async listDue(now, limit) {
      return productRows(
        db.driver
          .prepare(
            `SELECT s.body_json FROM product_schedules s JOIN products p ON p.id=s.product_id
        WHERE s.enabled=1 AND s.next_run_at<=? AND p.archived_at IS NULL ORDER BY s.next_run_at,s.product_id LIMIT ?`,
          )
          .all(now, pageSize(limit, 50, 1000)),
        productScheduleSchema,
      );
    },
    async saveSchedule(schedule, context) {
      const parsed = productScheduleSchema.safeParse(schedule);
      if (!parsed.success) return err(ValidationError({ field: 'schedule' }));
      const check = (): Result<void> =>
        (scheduleRow(schedule.productId)?.['revision'] ?? 0) === schedule.revision - 1
          ? ok(undefined)
          : err(ConflictError({ entity: 'productSchedule', id: schedule.productId }));
      return write(context, check, () => save(parsed.data));
    },
    async claimOccurrence(input) {
      const { productId, scheduledFor, now, leaseUntil, nextRunAt } = input;
      if (
        ![scheduledFor, now, leaseUntil, nextRunAt].every(Number.isSafeInteger) ||
        leaseUntil <= now ||
        nextRunAt <= now
      )
        return err(ValidationError({ field: 'occurrence' }));
      return inTransaction(db, 'productOccurrence', () => {
        const source = scheduleRow(productId);
        const product = db.driver.prepare('SELECT archived_at FROM products WHERE id=?').get(productId);
        if (!source || !product || product['archived_at'] !== null) return ok(null);
        const schedule = productRow(source, productScheduleSchema);
        if (!schedule.ok) return schedule;
        if (!schedule.value.enabled) return ok(null);
        const existing = db.driver
          .prepare('SELECT body_json FROM product_occurrences WHERE product_id=? AND scheduled_for=?')
          .get(productId, scheduledFor);
        if (existing) {
          const occurrence = productRow(existing, productOccurrenceSchema);
          if (!occurrence.ok) return occurrence;
          if (occurrence.value.state !== 'running' || occurrence.value.leaseUntil > now) return ok(null);
          const resumed = { ...occurrence.value, leaseUntil, updatedAt: now };
          putOccurrence(resumed);
          return ok(resumed);
        }
        if (schedule.value.nextRunAt !== scheduledFor || scheduledFor > now) return ok(null);
        const occurrence: ProductOccurrence = {
          id: newId<'ProductOccurrence'>(),
          productId,
          scheduledFor,
          state: 'running',
          leaseUntil,
          detail: null,
          createdAt: now,
          updatedAt: now,
        };
        putOccurrence(occurrence);
        save({ ...schedule.value, nextRunAt, revision: schedule.value.revision + 1 });
        return ok(occurrence);
      });
    },
    async expiredOccurrences(now, limit) {
      return productRows(
        db.driver
          .prepare(
            `SELECT o.body_json FROM product_occurrences o JOIN products p ON p.id=o.product_id
        JOIN product_schedules s ON s.product_id=o.product_id
        WHERE o.state='running' AND o.lease_until<=? AND p.archived_at IS NULL AND s.enabled=1
        ORDER BY o.lease_until,o.id LIMIT ?`,
          )
          .all(now, pageSize(limit, 50, 1000)),
        productOccurrenceSchema,
      );
    },
    async settleOccurrence(id, result) {
      return inTransaction(db, 'productOccurrence', () => {
        const row = db.driver.prepare('SELECT body_json FROM product_occurrences WHERE id=?').get(id);
        if (!row) return err(NotFoundError({ entity: 'productOccurrence', id }));
        const parsed = productRow(row, productOccurrenceSchema);
        if (!parsed.ok) return parsed;
        if (parsed.value.state !== 'running') return ok(undefined);
        putOccurrence({
          ...parsed.value,
          state: result.state,
          detail: result.detail?.slice(0, 2000) ?? null,
          updatedAt: db.clock(),
        });
        return ok(undefined);
      });
    },
  };
}
