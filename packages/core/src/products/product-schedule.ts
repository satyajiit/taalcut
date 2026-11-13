// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';

const scheduleFields = z.object({
  productId: idSchema<'Product'>(),
  revision: z.int().positive(),
  enabled: z.boolean(),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'An IANA time zone is required'),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.int().min(0).max(6)).min(1).max(7),
  nextRunAt: z.int().nonnegative().nullable(),
});
export const productScheduleSchema = scheduleFields.refine(
  (value) => !value.enabled || value.nextRunAt !== null,
  'An enabled schedule needs its next run',
);
export type ProductSchedule = z.output<typeof productScheduleSchema>;
export const productScheduleInputSchema = scheduleFields.omit({ nextRunAt: true });
export type ProductScheduleInput = z.output<typeof productScheduleInputSchema>;
export const productOccurrenceSchema = z.object({
  id: idSchema<'ProductOccurrence'>(),
  productId: idSchema<'Product'>(),
  scheduledFor: z.int().nonnegative(),
  state: z.enum(['running', 'completed', 'failed']),
  leaseUntil: z.int().nonnegative(),
  ideaIds: z.array(idSchema<'ProductIdea'>()).max(5).optional(),
  detail: z.string().max(2000).nullable(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type ProductOccurrence = z.output<typeof productOccurrenceSchema>;
export const PRODUCT_NOTIFICATION_KINDS = [
  'no-fresh-ideas',
  'ideas-ready',
  'draft-ready',
  'approval-required',
  'published',
  'failed',
] as const;
export const productNotificationSchema = z.object({
  id: idSchema<'ProductNotification'>(),
  productId: idSchema<'Product'>(),
  campaignId: idSchema<'ProductCampaign'>().nullable(),
  kind: z.enum(PRODUCT_NOTIFICATION_KINDS),
  title: z.string().max(500),
  body: z.string().max(2000),
  createdAt: z.int().nonnegative(),
  readAt: z.int().nonnegative().nullable(),
});
export type ProductNotification = z.output<typeof productNotificationSchema>;
