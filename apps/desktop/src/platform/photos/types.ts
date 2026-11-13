// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult } from '@taalcut/core';
import { z } from 'zod';

export const photosAuthorizationSchema = z.object({
  authorization: z.enum(['not_determined', 'restricted', 'denied', 'authorized', 'limited']),
});
export type PhotosAuthorization = z.output<typeof photosAuthorizationSchema>;

export const photosResourceSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.number().int().positive(),
  originalFilename: z.string().min(1),
  uti: z.string(),
  sizeBytes: z.null(),
  required: z.literal(true),
  role: z.enum(['original', 'paired_video']),
});
export type PhotosResource = z.output<typeof photosResourceSchema>;

export const photosAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['photo', 'video']),
  livePhoto: z.boolean(),
  resources: z.array(photosResourceSchema),
  photosMetadata: z.object({
    createdAt: z.number().nullable(),
    modifiedAt: z.number().nullable(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    favorite: z.boolean(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});
export type PhotosAsset = z.output<typeof photosAssetSchema>;

export const photosPageSchema = z.object({
  items: z.array(photosAssetSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
});
export type PhotosPage = z.output<typeof photosPageSchema>;

export interface PhotosExportOptions {
  /** A resource from the persisted, explicitly selected batch; revalidated by PhotoKit on export. */
  readonly assetId: string;
  readonly resource: PhotosResource;
  readonly dest: string;
  /** False unless the user explicitly allowed this selected batch to download its originals. */
  readonly allowNetwork?: boolean;
  /** Reservation from the shared destination-space coordinator, also enforced before each chunk write. */
  readonly byteLimit?: number;
  readonly signal: AbortSignal;
  readonly onBytes?: (bytesWritten: number) => void;
}

export interface ApplePhotosPort {
  /** Never requests permission. */
  status(signal?: AbortSignal): AsyncResult<PhotosAuthorization>;
  /** Only an explicit Connect command calls this. PhotoKit has no separate read-only permission level. */
  connect(signal?: AbortSignal): AsyncResult<PhotosAuthorization>;
  list(options?: {
    readonly cursor?: number;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): AsyncResult<PhotosPage>;
  /** Network access is always disabled, even for batches that opted into original downloads. */
  thumbnail(assetId: string, dest: string, signal?: AbortSignal): AsyncResult<{ path: string | null }>;
  exportOriginal(options: PhotosExportOptions): AsyncResult<{ path: string; bytesWritten: number }>;
  close(): Promise<void>;
}
