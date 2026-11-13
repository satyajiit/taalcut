// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The modules that each get their own model, reasoning level and fallback
 * chain (PRD 8, R27), and the shared value types a profile is built from.
 */
import { z } from 'zod';

export const MODULE_IDS = [
  'agent',
  'router',
  'vision',
  'embeddings',
  'speech',
  'voice',
  'music',
  'images',
] as const;
export const ModuleIdSchema = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

/** pi-ai's one reasoning setting, plus 'off'. Providers clamp to what a model supports. */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ReasoningLevelSchema = z.enum(REASONING_LEVELS);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

/** What kind of model a module needs. Only 'chat' runs through ModelClient today. */
export type ModelKind =
  'chat' | 'classifier' | 'image' | 'embedding' | 'speech-to-text' | 'text-to-speech' | 'music';

/** A capability a chat module needs from its model. */
export type ModelNeed = 'tools' | 'image-input';

export interface ModuleInfo {
  readonly id: ModuleId;
  /** Model kinds this module accepts, best first. */
  readonly kinds: readonly ModelKind[];
  readonly needs: readonly ModelNeed[];
  /** i18n keys; the renderer owns the English text. */
  readonly labelKey: string;
  readonly descriptionKey: string;
}

const info = (id: ModuleId, kinds: readonly ModelKind[], needs: readonly ModelNeed[] = []): ModuleInfo => ({
  id,
  kinds,
  needs,
  labelKey: `models.module.${id}.label`,
  descriptionKey: `models.module.${id}.description`,
});

export const MODULES: Readonly<Record<ModuleId, ModuleInfo>> = {
  agent: info('agent', ['chat'], ['tools']),
  // The router is a classifier (Clef or Jev, decision D5); a chat model can stand in.
  router: info('router', ['classifier', 'chat']),
  vision: info('vision', ['chat'], ['image-input']),
  embeddings: info('embeddings', ['embedding']),
  speech: info('speech', ['speech-to-text']),
  voice: info('voice', ['text-to-speech']),
  music: info('music', ['music']),
  images: info('images', ['image']),
};

/** One model choice: which provider and model, at which reasoning level. */
export const ModelChoiceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: ReasoningLevelSchema.optional(),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

/** Stable string key for a provider/model pair, e.g. 'openai/gpt-5.4'. */
export function choiceKey(choice: Pick<ModelChoice, 'provider' | 'model'>): string {
  return `${choice.provider}/${choice.model}`;
}
