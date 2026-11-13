// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fetches one hub template file and checks it against the index sha256.
 * A mismatch is a CDN race: refresh the index once and try the file again
 * (docs/template-hub.md section 10). The caller does not retry further.
 */
import {
  err,
  HUB_FORMAT_VERSION,
  HubIntegrity,
  HubNotFound,
  HubUnsupportedFormat,
  hubTemplateV0Schema,
  ok,
  type AsyncResult,
  type HubIndex,
  type HubTemplateId,
  type HubTemplateV0,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import { hubInvalidFrom } from './hub-invalid';
import type { HubTransport } from './hub-transport';

/** Just enough of a file to tell a newer format from a broken one. */
const formatVersionSchema = z.object({ formatVersion: z.int() });

export interface VerifiedTemplate {
  readonly document: HubTemplateV0;
  readonly sha256: string;
}

function parseDocument(body: unknown, hubId: HubTemplateId, version: number): Result<HubTemplateV0> {
  const declared = formatVersionSchema.safeParse(body);
  if (declared.success && declared.data.formatVersion !== HUB_FORMAT_VERSION)
    return err(HubUnsupportedFormat({ formatVersion: declared.data.formatVersion }));
  const parsed = hubTemplateV0Schema.safeParse(body);
  if (!parsed.success) return err(hubInvalidFrom(parsed.error));
  if (parsed.data.id !== hubId || parsed.data.version !== version) return err(HubIntegrity());
  return ok(parsed.data);
}

export async function readHubDocument(
  deps: {
    readonly transport: HubTransport;
    readonly loadIndex: (options: { readonly force: boolean }) => AsyncResult<{ readonly index: HubIndex }>;
  },
  hubId: HubTemplateId,
  expected: { readonly version: number; readonly sha256: string },
): AsyncResult<VerifiedTemplate> {
  const first = await deps.transport.template(hubId);
  if (!first.ok) return first;
  if (first.value.sha256 === expected.sha256) {
    const document = parseDocument(first.value.body, hubId, expected.version);
    return document.ok ? ok({ document: document.value, sha256: first.value.sha256 }) : document;
  }
  const refreshed = await deps.loadIndex({ force: true });
  if (!refreshed.ok) return err(HubIntegrity());
  const entry = refreshed.value.index.templates.find((item) => item.id === hubId);
  if (!entry || entry.version !== expected.version) return entry ? err(HubIntegrity()) : err(HubNotFound());
  const second = await deps.transport.template(hubId);
  if (!second.ok) return second;
  if (second.value.sha256 !== entry.sha256) return err(HubIntegrity());
  const document = parseDocument(second.value.body, hubId, entry.version);
  return document.ok ? ok({ document: document.value, sha256: second.value.sha256 }) : document;
}
