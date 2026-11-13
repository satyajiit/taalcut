// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import type { PostizOperation } from './postiz-operation-schema';

const id = z.string().min(1).max(500);
const positivePage = z.object({ page: z.number().int().min(1).optional() }).strict();
const httpUrl = z.url({ protocol: /^https?$/ });
const localId = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

export function mediaOperations(): PostizOperation[] {
  return [
    {
      name: 'uploadFile',
      description:
        'Upload a library asset or completed render using multipart form data. Supply exactly one assetId or renderId. Returns a Postiz media id and path.',
      method: 'POST',
      path: '/upload',
      access: ['media-write'],
      multipart: true,
      schema: z
        .object({
          assetId: localId.optional(),
          renderId: localId.optional(),
          expectedSha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          adjust: z.boolean().optional(),
        })
        .strict(),
    },
    {
      name: 'uploadFromUrl',
      description: 'Ask Postiz to import publicly accessible media. Use the returned id and path for posts.',
      method: 'POST',
      path: '/upload-from-url',
      access: ['media-write'],
      schema: z.object({ url: httpUrl, adjust: z.boolean().optional() }).strict(),
    },
    {
      name: 'getMediaStatus',
      description: 'Check media processing. Ready may include a warning that the original file was kept.',
      method: 'GET',
      path: '/media/{id}/status',
      access: ['media-read'],
      schema: z.object({ id }).strict(),
    },
    {
      name: 'listMedia',
      description: 'Search uploaded media and reuse its Postiz path; 18 results per page.',
      method: 'GET',
      path: '/media',
      access: ['media-read'],
      schema: positivePage.extend({ search: z.string().optional() }),
    },
    {
      name: 'generateVideo',
      description: 'Generate a video through Postiz. May consume credits.',
      method: 'POST',
      path: '/generate-video',
      access: ['media-generate'],
      schema: z
        .object({
          type: z.enum(['image-text-slides', 'veo3']),
          output: z.enum(['vertical', 'horizontal']),
          customParams: z.record(z.string(), z.json()),
        })
        .strict(),
    },
    {
      name: 'videoFunction',
      description: 'Invoke a video-generator helper, such as listing voices.',
      method: 'POST',
      path: '/video/function',
      access: ['media-generate'],
      schema: z
        .object({ functionName: id, identifier: id, params: z.record(z.string(), z.json()).optional() })
        .strict(),
    },
    {
      name: 'startClipping',
      description:
        'Create captioned vertical clips from a YouTube video, optionally with drafts on selected channels. Poll getClipping.',
      method: 'POST',
      path: '/clipping',
      access: ['media-generate', 'posts-write'],
      schema: z
        .object({
          url: httpUrl,
          integrations: z.array(id).max(20).optional(),
          clips: z.number().int().min(1).max(10).optional(),
          fit: z.enum(['blur', 'crop']).optional(),
        })
        .strict(),
    },
    {
      name: 'getClipping',
      description:
        'Read clipping progress and inspect each clip for failures, even when the job is completed.',
      method: 'GET',
      path: '/clipping/{id}',
      access: ['media-read'],
      schema: z.object({ id }).strict(),
    },
    {
      name: 'listClippings',
      description: 'List previous clippings, 20 per page.',
      method: 'GET',
      path: '/clipping',
      access: ['media-read'],
      schema: positivePage,
    },
  ];
}
