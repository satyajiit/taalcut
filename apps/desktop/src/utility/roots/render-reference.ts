// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Path d's source in the render process (REF1, render SPEC "REF1-SOUND"): the reel each template keeps on this Mac,
 * so an export mixes the reel's own music, the editor's preview plays it, and the export dialog offers it. The reel
 * comes from core's TemplateMediaStore: the library's, which render-root.ts registers with keep's
 * `registerTemplateMedia`. Without one no reel is here, and path d stops at preflight with its fix. The reel's link
 * and sound credit, for the "add this sound in the app" steps, come from the template version through the library's
 * template store, read only. render-root.ts spreads `renderReferenceAudio` into the engine's deps.
 */
import { ok, TemplateMediaStoreToken, type Container, type TemplateStore } from '@taalcut/core';
import { createTemplateStore } from '@taalcut/library';
import { keptReferenceAudio, type RenderEngineDeps } from '@taalcut/render';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { templateAssetsDir } from '../../shared/template-assets';
import { LibraryDatabaseToken } from '../../shared/tokens';

export function renderReferenceAudio(
  container: Container,
  config: Pick<UtilityConfig, 'userData'>,
): Pick<RenderEngineDeps, 'referenceAudio'> {
  let templates: Pick<TemplateStore, 'get'> | undefined;
  return {
    referenceAudio: keptReferenceAudio({
      // Asked at each export and preview, so a store registered after the engine was made is used.
      kept: async (templateId) =>
        container.has(TemplateMediaStoreToken)
          ? container.resolve(TemplateMediaStoreToken).get(templateId)
          : ok(null),
      version: async (ref) => {
        templates ??= createTemplateStore(container.resolve(LibraryDatabaseToken), {
          assetsDir: templateAssetsDir(config.userData),
        });
        const stored = await templates.get(ref.id, ref.version);
        return stored.ok ? ok(stored.value.json) : stored;
      },
    }),
  };
}
