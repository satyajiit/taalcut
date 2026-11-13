// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ in the agent process: the vision call `templates.breakdown` reads a reel's overlays with
 * (`@taalcut/templates` graphic-brief), over this process's ModelClient, resolved at call time.
 *
 * Which model: the chat's (the agent module's first choice) when it can see images, since a capable model reads a
 * reel's graphics best; else, or when it fails, the vision module's chain. Local only is the client's: a cloud
 * target is refused before anything is sent, and the vision chain keeps only the models on this Mac (the on-device
 * Qwen today). Temperature 0 and thinking off, so a reel read twice reads the same.
 *
 * Consent: the pictures are a reference reel's frames (each overlay's sheet, in the breakdown's experiment), which
 * since FIX-CONSENT go to a model without a card, as `templates.proposeEdits`' contact sheet does. The call log
 * records every attempt with a span of its own; the template records which model wrote the briefs.
 *
 * The recorded e2e roots carry no graphic calls in their cassettes, so they get no reader: their breakdowns brief
 * overlays from the measured facts alone.
 */
import { err, newId, NotImplementedError, ok, type Container } from '@taalcut/core';
import type { ModelChoice } from '@taalcut/models';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import type { GraphicModel } from '@taalcut/templates';

const log = (line: string) => console.warn(`[templates] ${line}`);
/** agent-recorded-models.ts's variable, named here so a release bundle never imports that test-only module. */
const RECORDED_MODELS_ENV = 'TAALCUT_TEST_RECORDED_MODELS';

/** The chat's model, when it is a model that takes images; null otherwise. */
function chatModelSeeing(container: Container): ModelChoice | null {
  if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return null;
  const chain = container.resolve(ModelProfilesToken).resolve('agent');
  const first = chain.ok ? chain.value.choices[0] : undefined;
  if (!first) return null;
  const info = container.resolve(ModelRuntimeToken).findModel(first.provider, first.model, 'chat');
  return info?.input.includes('image') ? first : null;
}

export function modelClientGraphics(container: Container): GraphicModel {
  return {
    async complete(request, signal) {
      if (!container.has(ModelClientToken))
        return err(NotImplementedError({ feature: 'graphic brief' }, { detail: 'No model client' }));
      const client = container.resolve(ModelClientToken);
      const base = {
        module: 'vision' as const,
        system: request.system,
        messages: [{ role: 'user' as const, content: [...request.content] }],
        maxTokens: request.maxTokens,
        temperature: 0,
        reasoning: 'off' as const,
        trace: { spanId: newId<'Span'>() },
        ...(signal ? { signal } : {}),
      };
      const chat = chatModelSeeing(container);
      if (chat) {
        const answer = await client.complete({ ...base, target: { ...chat, reasoning: 'off' } });
        if (answer.ok) {
          const { text, provider, model, local } = answer.value;
          return ok({ text, provider, model, local });
        }
        if (signal?.aborted) return answer;
        log(`graphic brief: the chat's model failed (${answer.error.code}); trying the vision chain`);
      }
      const answer = await client.complete(base);
      if (!answer.ok) {
        log(`graphic brief: the vision call failed (${answer.error.code})`);
        return answer;
      }
      const { text, provider, model, local } = answer.value;
      return ok({ text, provider, model, local });
    },
  };
}

/** The breakdown's graphic reader for this root, unless it replays recorded sessions or has no models. */
export function graphicModelOf(container: Container): { graphicModel?: GraphicModel } {
  if (process.env[RECORDED_MODELS_ENV]) return {};
  if (!container.has(ModelClientToken)) return {};
  return { graphicModel: modelClientGraphics(container) };
}
