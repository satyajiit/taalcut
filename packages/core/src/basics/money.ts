// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Money as whole micro-units, so sums never drift. Cards, budgets and cost estimates use it. */
import './zod-config';
import { z } from 'zod';

/** An amount of money as whole micro-units (1 USD = 1,000,000), so sums never drift. */
export const moneySchema = z.object({
  /** ISO 4217, e.g. 'USD'. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  micros: z.int(),
});
export type Money = z.output<typeof moneySchema>;
