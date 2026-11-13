// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tool idempotency keys: sha256 of the input's JSON, so the same input is the same action. */
import { createHash } from 'node:crypto';

export const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** `<tool>:<sha256 of the input>`. */
export const toolKey = (name: string, input: unknown): string => `${name}:${sha256(input)}`;
