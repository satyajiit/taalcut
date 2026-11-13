// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The profile format (R27). A profile sets every module at once: each module
 * gets a chain of model choices, primary first. The persisted state records
 * which profile is active, the user's per-module overrides, custom profiles and
 * the deprecation watcher's migrations. Everything here is plain JSON so the
 * library can store it and IPC can carry it.
 */
import { z } from 'zod';
import { ModelChoiceSchema, ModuleIdSchema, ReasoningLevelSchema } from '../modules';

export const BUILTIN_PROFILE_IDS = ['fast-cheap', 'balanced', 'best-quality', 'local-only'] as const;
export type BuiltinProfileId = (typeof BUILTIN_PROFILE_IDS)[number];
export const DEFAULT_PROFILE_ID: BuiltinProfileId = 'balanced';

export const ModuleSettingSchema = z.object({
  /** Primary first, then the fallback chain. Empty means the module is off in this profile. */
  chain: z.array(ModelChoiceSchema),
});
export type ModuleSetting = z.infer<typeof ModuleSettingSchema>;

export const ModelProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  /** i18n keys; profiles carry no English. */
  labelKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  modules: z.object({
    agent: ModuleSettingSchema,
    router: ModuleSettingSchema,
    vision: ModuleSettingSchema,
    embeddings: ModuleSettingSchema,
    speech: ModuleSettingSchema,
    voice: ModuleSettingSchema,
    music: ModuleSettingSchema,
    images: ModuleSettingSchema,
  }),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

/** A user's change to one module, on top of whatever profile is active. */
export const ModuleOverrideSchema = z
  .object({
    /** Replaces the profile's primary model. */
    primary: ModelChoiceSchema.optional(),
    /** Replaces the primary's reasoning level. */
    reasoning: ReasoningLevelSchema.optional(),
    /** Replaces the rest of the chain. */
    fallbacks: z.array(ModelChoiceSchema).optional(),
  })
  .refine((o) => o.primary !== undefined || o.reasoning !== undefined || o.fallbacks !== undefined, {
    message: 'An override must change something.',
  });
export type ModuleOverride = z.infer<typeof ModuleOverrideSchema>;

export const MigrationRecordSchema = z.object({
  /** ISO date the watcher ran. */
  on: z.string(),
  module: ModuleIdSchema,
  /** 'override' or the id of the custom profile that was changed. */
  where: z.string(),
  from: ModelChoiceSchema,
  to: ModelChoiceSchema,
  retiresOn: z.string(),
});
export type MigrationRecord = z.infer<typeof MigrationRecordSchema>;

export const ProfileStateSchema = z.object({
  version: z.literal(1),
  activeProfileId: z.string(),
  overrides: z.partialRecord(ModuleIdSchema, ModuleOverrideSchema).default({}),
  customProfiles: z.array(ModelProfileSchema).default([]),
  migrations: z.array(MigrationRecordSchema).default([]),
});
export type ProfileState = z.infer<typeof ProfileStateSchema>;

export function defaultProfileState(activeProfileId: string = DEFAULT_PROFILE_ID): ProfileState {
  return { version: 1, activeProfileId, overrides: {}, customProfiles: [], migrations: [] };
}
