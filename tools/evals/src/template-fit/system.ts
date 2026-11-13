// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real fit system for the eval (LRN1-TPL): @taalcut/timeline's fitter over the library's template store and
 * template index (world.ts) and the library folder's clips, profiled as the casting eval profiles them (probed with
 * ffprobe; what vision would have written comes from the manifest). The embedder is the casting eval's deterministic
 * one, in one space for slot intents and clip descriptions, so the eval measures fit's ranking, not the model.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fitTemplatesInputSchema, ok, unwrap, type AssetId } from '@taalcut/core';
import type { FfmpegBinaries } from '@taalcut/media';
import { createMemoryShotCatalog, createTemplateFitter, type TemplateFitter } from '@taalcut/timeline';
import { hashingEmbedder, loadCastingLibrary } from '../casting/library';
import { loadTemplateLibrary } from './library';
import type { FitCase, FitPrediction } from './schema';
import { openTemplateWorld, type TemplateWorld } from './world';

export interface FitSystem {
  fit(item: Pick<FitCase, 'caseId' | 'library' | 'pool'>): Promise<FitPrediction>;
  close(): Promise<void>;
}

export interface TimelineFitOptions {
  /** Library name (its templates.json `library`) → its folder. */
  readonly libraries: Readonly<Record<string, string>>;
  readonly binaries: FfmpegBinaries;
  /** An empty folder for each library's database. */
  readonly workDir: string;
}

interface Loaded {
  readonly world: TemplateWorld;
  readonly fitter: TemplateFitter;
  readonly assetIdOf: ReadonlyMap<string, AssetId>;
}

async function load(name: string, dir: string, options: TimelineFitOptions): Promise<Loaded> {
  const clips = await loadCastingLibrary(dir, options.binaries);
  const templates = loadTemplateLibrary(dir);
  const workDir = join(options.workDir, name);
  mkdirSync(workDir, { recursive: true });
  const world = await openTemplateWorld({
    dir: workDir,
    embedder: hashingEmbedder(),
    templates: templates.templates,
  });
  const fitter = createTemplateFitter({
    profiles: createMemoryShotCatalog(clips.profiles),
    templates: world.store,
    vectors: async () => ok(world.vectors),
  });
  const assetIdOf = new Map([...clips.assetOf].map(([assetId, path]) => [path, assetId as AssetId]));
  return { world, fitter, assetIdOf };
}

export function timelineFitSystem(options: TimelineFitOptions): FitSystem {
  const loaded = new Map<string, Promise<Loaded>>();
  const library = (name: string) => {
    const found = loaded.get(name);
    if (found) return found;
    const dir = options.libraries[name];
    if (dir === undefined) throw new Error(`No folder for template fit library ${name}: pass --library`);
    const loading = load(name, dir, options);
    loaded.set(name, loading);
    return loading;
  };

  return {
    async fit(item) {
      const { world, fitter, assetIdOf } = await library(item.library);
      const assetIds = item.pool.map((path) => {
        const id = assetIdOf.get(path);
        if (id === undefined) throw new Error(`${item.caseId}: ${path} is not a clip of ${item.library}`);
        return id;
      });
      const fitted = unwrap(
        await fitter.fitTemplates(
          fitTemplatesInputSchema.parse({ pool: { assetIds }, templates: {}, limit: 50 }),
        ),
      );
      return {
        caseId: item.caseId,
        library: item.library,
        poolShots: fitted.poolShots,
        ranking: fitted.fits.map((fit) => ({
          template: world.keyOf.get(fit.summary.id) ?? fit.summary.id,
          slots: fit.slots,
          covered: fit.covered,
          coverage: fit.coverage,
          meanScore: fit.meanScore,
        })),
      };
    },
    async close() {
      // A library that failed to load has already failed the fit that asked for it.
      const settled = await Promise.allSettled(loaded.values());
      for (const item of settled) if (item.status === 'fulfilled') item.value.world.close();
    },
  };
}
