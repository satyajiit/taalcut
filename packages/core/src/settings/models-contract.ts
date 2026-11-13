// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.models, served by the agent process, which owns @taalcut/models'
 * ModelProfiles. The shapes restate models' ProfileState, EffectiveModule and
 * RetirementNotice as plain JSON.
 *
 * Reads only. Every change is a command on the bus (MODEL_COMMANDS below), so
 * Settings, ⌘K and the agent share one path, with undo and an audit entry.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { eventIterator, ipc } from '../ipc/contract';
import { MODEL_MODULE_IDS, REASONING_LEVELS } from '../ports/model-ports';

export const HARDWARE_TIERS = ['minimum', 'recommended', 'high'] as const;
export type HardwareTier = (typeof HARDWARE_TIERS)[number];

export const moduleIdSchema = z.enum(MODEL_MODULE_IDS);
export const reasoningLevelSchema = z.enum(REASONING_LEVELS);

export const modelChoiceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: reasoningLevelSchema.optional(),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const moduleOverrideSchema = z.object({
  primary: modelChoiceSchema.optional(),
  reasoning: reasoningLevelSchema.optional(),
  fallbacks: z.array(modelChoiceSchema).optional(),
});
export type ModuleOverride = z.infer<typeof moduleOverrideSchema>;

/** One module as the next call will run it (models' `effective(module)`), plus the user's override. */
export const moduleStateSchema = z.object({
  module: moduleIdSchema,
  labelKey: z.string(),
  descriptionKey: z.string(),
  /** Whether a reasoning level means anything for this module (chat modules). */
  reasoning: z.boolean(),
  /** Primary first. Empty when the module is off in this profile. */
  chain: z.array(modelChoiceSchema),
  skipped: z.array(
    z.object({
      choice: modelChoiceSchema,
      reason: z.enum(['needs-higher-tier', 'retired']),
      replacedBy: modelChoiceSchema.optional(),
    }),
  ),
  override: moduleOverrideSchema.optional(),
});
export type ModuleState = z.infer<typeof moduleStateSchema>;

export const profileSummarySchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  descriptionKey: z.string(),
  builtin: z.boolean(),
});

export const retirementNoticeSchema = z.object({
  module: moduleIdSchema,
  /** 'override' or the id of the profile that holds the choice. */
  where: z.string(),
  choice: modelChoiceSchema,
  /** ISO date. */
  retiresOn: z.string(),
  /** Negative once retired. */
  daysLeft: z.int(),
  replacement: modelChoiceSchema.optional(),
});
export type RetirementNotice = z.infer<typeof retirementNoticeSchema>;

export const modelSettingsSchema = z.object({
  activeProfileId: z.string(),
  /** assessHardware(info).defaultProfileId: what "Use recommended" picks. */
  recommendedProfileId: z.string(),
  tier: z.enum(HARDWARE_TIERS),
  profiles: z.array(profileSummarySchema),
  /** In MODEL_MODULE_IDS order. */
  modules: z.array(moduleStateSchema),
  /** models' retirements({ horizonDays: 30 }) for the active profile and the user's overrides. */
  retirements: z.array(retirementNoticeSchema),
});
export type ModelSettings = z.infer<typeof modelSettingsSchema>;

/**
 * Where a local model runs: the backends of core's computeBackendSchema
 * (compute/backend.ts) that model runtimes use, by the same names, which are
 * @taalcut/models' ComputeBackend too.
 */
export const MODEL_COMPUTE_BACKENDS = [
  'metal',
  'mlx',
  'coreml',
  'ane',
  'webgpu',
  'cuda',
  'rocm',
  'directml',
  'vulkan',
  'cpu',
] as const;
export type ModelComputeBackend = (typeof MODEL_COMPUTE_BACKENDS)[number];

/** Why a model runs on the CPU, as the i18n keys `fallbackReasonKey` carries (the renderer has a message for each). */
export const CPU_FALLBACK_REASON_KEYS = [
  'compute.fallback.no_gpu_kernels',
  'compute.fallback.gpu_unsupported',
  'compute.fallback.gpu_out_of_memory',
  'compute.fallback.gpu_failed_at_runtime',
  /** GPU acceleration is turned off (TAALCUT_FORCE_CPU, the CPU-only test path). LNX1. */
  'compute.fallback.disabled',
] as const;

/** Where a local model would run here (the model picker; Settings → About for the modules in use). */
export const optionComputeSchema = z.object({
  backend: z.enum(MODEL_COMPUTE_BACKENDS),
  /** On a GPU or the Neural Engine. */
  accelerated: z.boolean(),
  /** 'models.compute.<backend>'. */
  labelKey: z.string(),
  /** For 'cpu': one of CPU_FALLBACK_REASON_KEYS. */
  fallbackReasonKey: z.string().optional(),
});
export type OptionCompute = z.infer<typeof optionComputeSchema>;

/** A model the user may pick for a module (pi-ai's list plus MODEL_CATALOG). */
export const modelOptionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** pi-ai's display name, e.g. 'GPT-5.4'. A product name: shown as is, never translated. */
  name: z.string(),
  local: z.boolean(),
  /** Supports a reasoning level. */
  reasoning: z.boolean(),
  /**
   * The reasoning levels it takes, lightest first (pi-ai's
   * getSupportedThinkingLevels; on-device models: 'off' only). What the
   * chat's effort control offers for it (chat/effort.ts). Absent: unknown.
   */
  thinking: z.array(reasoningLevelSchema).optional(),
  /** In a built-in profile's chain for this module: the short list the chat's model menu offers. */
  inProfile: z.boolean().optional(),
  /** Catalogue note, e.g. 'models.note.local_lower_quality'. */
  noteKey: z.string().optional(),
  retiresOn: z.string().optional(),
  /** Why it can't be chosen right now; absent when it can. 'not-installed': an on-device model not downloaded yet. */
  unavailable: z.enum(['needs-higher-tier', 'not-configured', 'not-installed', 'retired']).optional(),
  /** Local models: where it would run on this Mac. */
  compute: optionComputeSchema.optional(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const modelsContract = {
  /** The current settings. */
  settings: ipc.output(modelSettingsSchema),
  /** The current settings first, then after every change (Settings, ⌘K, the agent, the deprecation watcher). */
  changed: ipc.output(eventIterator(modelSettingsSchema)),
  /** What can be picked for one module, best first. */
  options: ipc.input(z.object({ module: moduleIdSchema })).output(z.array(modelOptionSchema)),
};

/**
 * Commands the agent process registers on the bus for models (app-wide:
 * project null). Payloads are exactly these; each returns an inverse so undo
 * works. `restore` is internal: it is the inverse the others store, and only
 * undo and redo run it.
 */
export const MODEL_COMMANDS = {
  setProfile: 'models.setProfile',
  setModuleOverride: 'models.setModuleOverride',
  clearModuleOverride: 'models.clearModuleOverride',
  useRecommended: 'models.useRecommended',
  restore: 'models.restore',
} as const;

/** What `models.restore` puts back: the active profile and every override, as they were. */
export const modelSelectionSchema = z.object({
  activeProfileId: z.string().min(1),
  overrides: z.partialRecord(moduleIdSchema, moduleOverrideSchema),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelCommandPayloads = {
  [MODEL_COMMANDS.setProfile]: z.object({ profileId: z.string().min(1) }),
  [MODEL_COMMANDS.setModuleOverride]: z.object({ module: moduleIdSchema, override: moduleOverrideSchema }),
  [MODEL_COMMANDS.clearModuleOverride]: z.object({ module: moduleIdSchema }),
  // Active profile = the tier's recommended one, overrides cleared.
  [MODEL_COMMANDS.useRecommended]: z.object({}),
  [MODEL_COMMANDS.restore]: modelSelectionSchema,
};
