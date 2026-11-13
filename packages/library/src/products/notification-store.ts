// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  NotFoundError,
  ok,
  productNotificationSchema,
  ValidationError,
  type ProductStore,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { attemptWrite, pageSize } from '../repositories/shared';
import { stagedWriter } from '../stores/staged-write';
import { productRows } from './rows';

export function productNotificationStore(
  db: LibraryDatabase,
  commands?: CommandStager,
): Pick<ProductStore, 'appendNotification' | 'listNotifications' | 'readNotification'> {
  const write = stagedWriter(db, commands, 'productNotification');
  return {
    async appendNotification(notification) {
      const parsed = productNotificationSchema.safeParse(notification);
      if (!parsed.success) return err(ValidationError({ field: 'notification' }));
      const result = attemptWrite(db, 'productNotification', () =>
        db.driver
          .prepare(
            `INSERT INTO product_notifications
        (id,product_id,created_at,read_at,body_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            notification.id,
            notification.productId,
            notification.createdAt,
            notification.readAt,
            JSON.stringify(parsed.data),
          ),
      );
      return result.ok ? ok(undefined) : result;
    },
    async listNotifications(input = {}) {
      return productRows(
        db.driver
          .prepare(
            `SELECT body_json FROM product_notifications
        WHERE (? IS NULL OR product_id=?) AND (?=0 OR read_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT ?`,
          )
          .all(
            input.productId ?? null,
            input.productId ?? null,
            Number(input.unreadOnly ?? false),
            pageSize(input.limit, 100, 500),
          ),
        productNotificationSchema,
      );
    },
    async readNotification(id, at, context) {
      return write(
        context,
        () =>
          db.driver.prepare('SELECT id FROM product_notifications WHERE id=?').get(id)
            ? ok(undefined)
            : err(NotFoundError({ entity: 'productNotification', id })),
        () => {
          db.driver
            .prepare(
              "UPDATE product_notifications SET read_at=?,body_json=json_set(body_json,'$.readAt',?) WHERE id=?",
            )
            .run(at, at, id);
        },
      );
    },
  };
}
