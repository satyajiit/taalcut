// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A provider answer checked against its schema at the boundary: a mismatch is the provider's error, never a throw. */
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { ModelProviderError } from '../errors';
import { ELEVENLABS_PROVIDER } from './config';
import { wireJson, type WireResponse } from './wire-types';

export function parseWire<S extends z.ZodType>(
  schema: S,
  response: WireResponse,
  model: string,
): Result<z.output<S>> {
  const parsed = schema.safeParse(wireJson(response));
  if (parsed.success) return ok(parsed.data);
  return err(
    ModelProviderError(
      { provider: ELEVENLABS_PROVIDER, model },
      { detail: `Unexpected answer: ${z.prettifyError(parsed.error).slice(0, 1000)}` },
    ),
  );
}
