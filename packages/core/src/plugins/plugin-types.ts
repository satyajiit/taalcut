// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';

export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const text = z.string().min(1).max(4000);
const named = z.object({ id: pluginIdSchema, name: text, description: text });
export const pluginSkillSchema = named;
export const pluginAccessSchema = named;
export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: text,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: text,
  summary: text,
  description: text,
  logo: pluginIdSchema,
  homepage: z.url(),
  docs: z.url(),
  features: z.array(named.extend({ access: z.array(pluginIdSchema) })).max(100),
  access: z.array(pluginAccessSchema).max(100),
  credentials: z.array(named.extend({ required: z.boolean() })).max(20),
  configFields: z
    .array(
      named.extend({
        kind: z.enum(['url', 'string']),
        defaultValue: z.string().max(2048),
        required: z.boolean(),
      }),
    )
    .max(20),
  skills: z.array(pluginSkillSchema).max(100),
});
export type PluginManifest = z.output<typeof pluginManifestSchema>;
export type PluginAccess = z.output<typeof pluginAccessSchema>;
export type PluginSkill = z.output<typeof pluginSkillSchema>;

export const pluginToolSchema = z.object({
  name: z.string().min(1).max(160),
  description: text,
  inputSchema: z.record(z.string(), z.unknown()),
  access: z.array(pluginIdSchema),
  sideEffect: z.enum(['read', 'external']),
  source: z.enum(['api', 'mcp']),
});
export type PluginTool = z.output<typeof pluginToolSchema>;
export const pluginConfigSchema = z.record(pluginIdSchema, z.string().max(2048));
export const pluginViewSchema = z.object({
  manifest: pluginManifestSchema,
  enabled: z.boolean(),
  status: z.enum(['disconnected', 'inactive', 'active', 'error']),
  configuredCredentials: z.array(pluginIdSchema),
  config: pluginConfigSchema,
  grantedAccess: z.array(pluginIdSchema),
  setupRequested: z.boolean(),
  lastCheckedAt: z.number().int().nonnegative().nullable(),
  error: publicErrorSchema.optional(),
});
export type PluginView = z.output<typeof pluginViewSchema>;
export const pluginSkillContentSchema = pluginSkillSchema.extend({ content: z.string().max(100_000) });
export type PluginSkillContent = z.output<typeof pluginSkillContentSchema>;
export const pluginInvokeSchema = z.object({
  pluginId: pluginIdSchema,
  toolName: z.string().min(1).max(160),
  input: z.record(z.string(), z.unknown()),
  mode: z.enum(['read', 'external']),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type PluginInvoke = z.output<typeof pluginInvokeSchema>;
