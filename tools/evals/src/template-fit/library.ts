// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template library folder for the template evals (LRN1-TPL): `templates/*.json` (Template documents as the app
 * exports them) and `templates.json`, which names each one and says whether the set is synthetic. The fit eval's
 * folders also hold the casting eval's `manifest.json` and `clips/`, so a golden casting library becomes a fit
 * library by adding its templates. Labels and predictions are folders of lists, read with labelled-files.ts.
 */
import { join } from 'node:path';
import { migrateTemplate } from '@taalcut/templates';
import { z } from 'zod';
import { readJson } from '../files';
import { parseNamed } from '../schema';
import type { WorldTemplate } from './world';

export const TEMPLATES_MANIFEST = 'templates.json';

export const templatesManifestSchema = z
  .object({
    library: z.string().min(1),
    synthetic: z.boolean(),
    templates: z
      .array(
        z
          .object({
            /** Under the library folder, e.g. templates/beach.json. */
            file: z.string().min(1),
            name: z.string().min(1).max(120),
            tags: z.array(z.string().min(1).max(32)).max(12).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type TemplatesManifest = z.infer<typeof templatesManifestSchema>;

export interface TemplateLibrary {
  readonly name: string;
  readonly dir: string;
  readonly synthetic: boolean;
  /** Keyed by their file. */
  readonly templates: readonly WorldTemplate[];
}

export function loadTemplateLibrary(dir: string): TemplateLibrary {
  const path = join(dir, TEMPLATES_MANIFEST);
  const manifest = parseNamed(templatesManifestSchema, readJson(path), path);
  const templates = manifest.templates.map((entry) => {
    const json = readJson(join(dir, entry.file)) as { schemaVersion?: unknown };
    const migrated = migrateTemplate(json, typeof json.schemaVersion === 'number' ? json.schemaVersion : 1);
    if (!migrated.ok) throw new Error(`${entry.file}: ${migrated.error.code} ${migrated.error.detail ?? ''}`);
    return {
      key: entry.file,
      template: migrated.value,
      name: entry.name,
      ...(entry.tags ? { tags: entry.tags } : {}),
    };
  });
  return { name: manifest.library, dir, synthetic: manifest.synthetic, templates };
}
