// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';

const url = z.url({ protocol: /^https$/ }).max(2048);
/** Creator-supplied or source-backed identity; no credentials or inferred link availability. */
export const creatorProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  youtubeHandle: z.string().trim().min(1).max(100).optional(),
  instagramHandle: z.string().trim().min(1).max(100).optional(),
  youtubeUrl: url.optional(),
  profileLinkUrl: url.optional(),
  tone: z.string().max(240).optional(),
  audience: z.string().max(240).optional(),
  cta: z.string().max(160).optional(),
  profileLinkConfirmed: z.boolean().default(false),
  postizIntegrationIds: z
    .object({
      youtube: z.string().min(1).max(500).optional(),
      instagram: z.string().min(1).max(500).optional(),
    })
    .optional(),
});
export type CreatorProfile = z.output<typeof creatorProfileSchema>;
