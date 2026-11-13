// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 lane A's agent tools (A3: `audio.listen`, `audio.compare`, `audio.critique`), joined to the agent's tools by
 * agent-audio.ts's `withAudioTools`, so lane A never edits that file. They join the `audio` module after the tools
 * it already has (recorded sessions keep their order). The listening itself runs in the jobs process
 * (`audio.listen.analyse` / `audio.listen.query` over this process's JobRunnerToken); a template's reel for the
 * critique's reference profile comes from the template store, as the breakdown kept it (EAR1-C1). EAR1-G1: the
 * template's reel itself, for `audio.compare`'s `{ templateId }`, is the file the template media store keeps (REF1).
 */
import { join } from 'node:path';
import {
  defineToolModule,
  JobRunnerToken,
  ok,
  TemplateMediaStoreToken,
  TemplateStoreToken,
  templateListeningSchema,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import { critiqueTool, listenTools, type ListenQaToolDeps } from '@taalcut/audio';
import { renderAssetFiles } from '../../shared/render-ports';
import { UtilityConfigToken } from '../../shared/tokens';

function templateListening(container: Container): Pick<ListenQaToolDeps, 'templateListening'> {
  if (!container.has(TemplateStoreToken)) return {};
  const store = container.resolve(TemplateStoreToken);
  return {
    templateListening: async (templateId) => {
      const stored = await store.get(templateId);
      if (!stored.ok) return stored;
      // The head version as stored; only its listening is read, checked against core's schema.
      const json = stored.value.json as { readonly audio?: { readonly listening?: unknown } } | null;
      const parsed = templateListeningSchema.safeParse(json?.audio?.listening);
      return ok(parsed.success ? parsed.data : null);
    },
  };
}

/** The reel a template keeps, when it has sound; asked at each call (the store may be registered later). */
export function templateReel(container: Container): Pick<ListenQaToolDeps, 'templateReel'> {
  return {
    templateReel: async (templateId) => {
      if (!container.has(TemplateMediaStoreToken)) return ok(null);
      const kept = await container.resolve(TemplateMediaStoreToken).get(templateId);
      if (!kept.ok) return kept;
      return ok(kept.value?.media.hasAudio ? kept.value.path : null);
    },
  };
}

export function listenQaToolModules(container: Container): ToolModule[] {
  if (!container.has(JobRunnerToken) || !container.has(UtilityConfigToken)) return [];
  const deps: ListenQaToolDeps = {
    jobs: container.resolve(JobRunnerToken),
    assets: renderAssetFiles(container),
    scratch: join(container.resolve(UtilityConfigToken).userData, 'scratch', 'listen'),
    ...templateListening(container),
    ...templateReel(container),
  };
  return [defineToolModule({ id: 'audio', tools: [...listenTools(deps), critiqueTool(deps)] })];
}
