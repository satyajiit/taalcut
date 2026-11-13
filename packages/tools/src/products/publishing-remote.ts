// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, ValidationError, type AsyncResult, type ProductPublishRecord } from '@taalcut/core';
import { z } from 'zod';
import { productPlatformFor } from './publishing-copy';
import type { ProductPublisherDeps, ProductPublishingAccount } from './publishing-types';

export type ProductPluginPort = ProductPublisherDeps['plugins'];
export const postizRead = (plugins: ProductPluginPort, name: string, input: Record<string, unknown>) =>
  plugins.invoke({ pluginId: 'postiz', toolName: `api.${name}`, input, mode: 'read' });
export const postizWrite = (
  plugins: ProductPluginPort,
  name: string,
  input: Record<string, unknown>,
  key: string,
) =>
  plugins.invoke({
    pluginId: 'postiz',
    toolName: `api.${name}`,
    input,
    mode: 'external',
    idempotencyKey: key,
  });

const accountsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    identifier: z.string().optional(),
    providerIdentifier: z.string().optional(),
    disabled: z.boolean().optional(),
  }),
);
export async function productPublishingAccounts(
  plugins: ProductPluginPort,
): AsyncResult<readonly ProductPublishingAccount[]> {
  const result = await postizRead(plugins, 'listIntegrations', {});
  if (!result.ok) return result;
  const parsed = accountsSchema.safeParse(result.value);
  if (!parsed.success) return err(ValidationError({ field: 'postiz.accounts' }));
  return ok(
    parsed.data.flatMap((account) => {
      const provider = account.identifier ?? account.providerIdentifier ?? '';
      const platform = productPlatformFor(provider);
      return platform && !account.disabled
        ? [{ id: account.id, name: account.name, provider, platform }]
        : [];
    }),
  );
}

export const mediaResponseSchema = z.object({ id: z.string().min(1), path: z.url({ protocol: /^https?$/ }) });
export const createdPostsSchema = z.array(z.object({ postId: z.string().min(1), integration: z.string() }));
export const channelSettingsSchema = z.object({
  output: z.object({ maxLength: z.number().positive().optional() }),
});

const postSchema = z.object({
  id: z.string(),
  content: z.string(),
  publishDate: z.string(),
  state: z.string(),
  releaseURL: z.string().nullish(),
  integration: z.object({ id: z.string() }),
  image: z.unknown().optional(),
});
export const postListSchema = z.object({ posts: z.array(postSchema) });

/** An ID is authoritative; content/time alone cannot prove an uncertain write succeeded. */
export function matchingRemotePost(
  record: ProductPublishRecord,
  rows: z.output<typeof postListSchema>['posts'],
) {
  return record.remotePostId
    ? rows.find((post) => post.id === record.remotePostId && post.integration.id === record.accountId)
    : undefined;
}
