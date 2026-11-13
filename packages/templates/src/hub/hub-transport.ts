// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the hub client talks to the static index and the Worker. The fetch implementation is
 * `createFetchHubTransport`; tests pass a fake. Worker responses are validated by the transport (core's
 * worker-api schemas), so callers get typed values. The index and template files come back unparsed: the index
 * client and readHubDocument validate them, the file against its sha256 first. The install key never appears on
 * this interface: the transport adds it to write bodies.
 */
import type {
  AsyncResult,
  HubRating,
  HubReportReason,
  HubSubmissionId,
  HubTemplateId,
  HubTemplateV0,
  hubRatingsSchema,
  hubReportResponseSchema,
  hubSubmissionResponseSchema,
  hubSubmissionStateSchema,
} from '@taalcut/core';
import type { z } from 'zod';

/** A conditional GET of the index: 304 has no body and the caller keeps its cache. */
export type HubIndexFetch =
  | { readonly status: 200; readonly body: unknown; readonly etag: string | null }
  | { readonly status: 304; readonly etag: string | null };

export type HubRatingsDocument = z.output<typeof hubRatingsSchema>;
export type HubSubmissionResponse = z.output<typeof hubSubmissionResponseSchema>;
export type HubSubmissionStateResponse = z.output<typeof hubSubmissionStateSchema>;
export type HubReportResponse = z.output<typeof hubReportResponseSchema>;

export interface HubReportRequest {
  readonly hubId: HubTemplateId;
  readonly reason: HubReportReason;
  readonly note?: string;
}

export interface HubTransport {
  index(etag: string | null): AsyncResult<HubIndexFetch>;
  /** The template file, parsed as JSON, and the sha256 of the exact bytes received. */
  template(hubId: HubTemplateId): AsyncResult<{ readonly body: unknown; readonly sha256: string }>;
  ratings(): AsyncResult<HubRatingsDocument>;
  submit(body: { readonly template: HubTemplateV0 }): AsyncResult<HubSubmissionResponse>;
  submission(id: HubSubmissionId): AsyncResult<HubSubmissionStateResponse>;
  rate(hubId: HubTemplateId, body: { readonly stars: number }): AsyncResult<HubRating>;
  withdrawRating(hubId: HubTemplateId): AsyncResult<HubRating>;
  report(body: HubReportRequest): AsyncResult<HubReportResponse>;
}
