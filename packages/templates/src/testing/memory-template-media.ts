// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A TemplateMediaStore for tests (REF1): files in `<root>/<template id>/`, as the library keeps them, with the rows
 * in memory. `exists` stands for the template store (keep refuses a template that is gone).
 */
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  type TemplateId,
  type TemplateMedia,
  type TemplateMediaStore,
} from '@taalcut/core';
import { fileSha256 } from '../breakdown/fingerprint';

export interface MemoryTemplateMediaStore extends TemplateMediaStore {
  readonly root: string;
  readonly rows: Map<TemplateId, TemplateMedia>;
}

export function createMemoryTemplateMediaStore(options: {
  readonly root: string;
  readonly now: () => number;
  readonly exists?: (templateId: TemplateId) => Promise<boolean>;
}): MemoryTemplateMediaStore {
  const rows = new Map<TemplateId, TemplateMedia>();
  return {
    root: options.root,
    rows,
    async keep(templateId, input) {
      if (options.exists && !(await options.exists(templateId)))
        return err(NotFoundError({ entity: 'template', id: templateId }));
      const found = await stat(input.path).catch(() => null);
      if (!found?.isFile()) return err(NotFoundError({ entity: 'file' }, { detail: input.path }));
      const file = `reference${extname(input.path).toLowerCase() || '.mp4'}`;
      const dir = join(options.root, templateId);
      await mkdir(dir, { recursive: true });
      const target = join(dir, file);
      if (input.mode === 'move') await rename(input.path, target);
      else await copyFile(input.path, target);
      const sha256 = await fileSha256(target);
      if (!sha256.ok) return sha256;
      const media: TemplateMedia = {
        file,
        bytes: (await stat(target)).size,
        durationMs: input.durationMs,
        sha256: sha256.value,
        hasAudio: input.hasAudio,
        source: input.source,
        keptAt: options.now(),
      };
      rows.set(templateId, media);
      return ok(media);
    },
    async get(templateId) {
      const media = rows.get(templateId);
      if (!media) return ok(null);
      const path = join(options.root, templateId, media.file);
      return (await stat(path).catch(() => null))?.isFile() ? ok({ media, path }) : ok(null);
    },
    async remove(templateId) {
      rows.delete(templateId);
      await rm(join(options.root, templateId), { recursive: true, force: true });
      return ok(undefined);
    },
  };
}
