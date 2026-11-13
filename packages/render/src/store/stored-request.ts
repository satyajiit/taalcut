// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored render's request with today's defaults applied. A row written before Phase 3 has no
 * `contentCredentials` or `includeBumpers` (core defaults them to off and on); reading `request.includeBumpers`
 * straight from such a row would see undefined and skip the bumpers. Render reads stored requests only
 * through here (contract review P3-1, finding 11).
 */
import { exportRequestSchema, type ExportRequest, type RenderRecord, type Result } from '@taalcut/core';
import { parsedAs } from '../validate';

/** `request` is typed loosely on purpose: the store hands back what it wrote, which may predate a default. */
export function storedRequest(record: {
  readonly id: RenderRecord['id'];
  readonly request: unknown;
}): Result<ExportRequest> {
  return parsedAs(exportRequestSchema, record.request, 'request', `render ${record.id}: `);
}
