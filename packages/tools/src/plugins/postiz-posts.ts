// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import type { PostizOperation } from './postiz-operation-schema';

const id = z.string().min(1).max(500);
const date = z.iso.datetime({ offset: true });
const record = z.record(z.string(), z.json());
const media = z
  .object({ id, path: z.url(), thumbnailTimestamp: z.number().nonnegative().optional() })
  .passthrough();
const content = z
  .object({ content: z.string(), id: id.optional(), image: z.array(media).optional() })
  .passthrough();
const post = z
  .object({
    integration: z.object({ id }),
    value: z.array(content).min(1),
    group: id.optional(),
    settings: record.optional(),
  })
  .passthrough();

export function postOperations(): PostizOperation[] {
  return [
    {
      name: 'listPosts',
      description: 'List posts and current provider settings within an ISO date range.',
      method: 'GET',
      path: '/posts',
      access: ['posts-read'],
      schema: z.object({ startDate: date, endDate: date, customer: id.optional() }).strict(),
    },
    {
      name: 'createPost',
      description:
        'Create a draft, scheduled or immediate post. Upload media first and inspect each channel’s settings. This can publish to social accounts.',
      method: 'POST',
      path: '/posts',
      access: ['posts-write'],
      schema: z
        .object({
          type: z.enum(['draft', 'schedule', 'now']),
          date,
          shortLink: z.boolean(),
          order: z.string().optional(),
          inter: z.number().optional(),
          tags: z.array(z.object({ value: z.string(), label: z.string() })),
          posts: z.array(post).optional(),
        })
        .strict(),
    },
    {
      name: 'deletePost',
      description: 'Delete a post and every post in the same group.',
      method: 'DELETE',
      path: '/posts/{id}',
      access: ['posts-write'],
      schema: z.object({ id }).strict(),
    },
    {
      name: 'deletePostByGroup',
      description: 'Delete all posts in a group.',
      method: 'DELETE',
      path: '/posts/group/{group}',
      access: ['posts-write'],
      schema: z.object({ group: id }).strict(),
    },
    {
      name: 'getMissingContent',
      description: 'Find provider content for a published post whose release ID is missing.',
      method: 'GET',
      path: '/posts/{id}/missing',
      access: ['posts-read'],
      schema: z.object({ id }).strict(),
    },
    {
      name: 'updateReleaseId',
      description: 'Link a post to its published provider content to restore analytics.',
      method: 'PUT',
      path: '/posts/{id}/release-id',
      access: ['posts-write'],
      schema: z.object({ id, releaseId: id }).strict(),
    },
    {
      name: 'changePostStatus',
      description: 'Move a post to draft or schedule. Scheduling starts publishing at the stored date.',
      method: 'PUT',
      path: '/posts/{id}/status',
      access: ['posts-write'],
      schema: z.object({ id, status: z.enum(['draft', 'schedule']) }).strict(),
    },
    {
      name: 'updatePostSettings',
      description: 'Merge provider settings into an unpublished draft or scheduled post. Omit __type.',
      method: 'PUT',
      path: '/posts/{id}/settings',
      access: ['posts-write'],
      schema: z.object({ id, settings: record }).strict(),
    },
  ];
}
