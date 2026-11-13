// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type HubTemplateV0 } from '@taalcut/core/hub';

import { sha256Hex } from '../encoding/bytes';
import { isRecord } from '../http/json';

/** Pretty-printed, keys sorted, trailing newline: the bytes stored in the hub repository. */
export function canonicalTemplate(template: HubTemplateV0): string {
  return `${JSON.stringify(sortValue(template), null, 2)}\n`;
}

export async function templateSha256(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key]);
  return sorted;
}
