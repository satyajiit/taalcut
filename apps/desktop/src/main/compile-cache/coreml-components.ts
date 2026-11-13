// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The installed component versions that carry Core ML models (IX3-B6): the ones whose models the mac helper loads and
 * Core ML compiles per path (the embedder's `embeddinggemma-2-coreml`, the shot model's `transnetv2-coreml`,
 * Parakeet's FluidAudio build). Found from the installed-components registry (packages/jobs, `registry.json`) and the
 * files themselves: a component counts when its folder holds a compiled model (`*.mlmodelc`) or a package
 * (`*.mlpackage`) at its top or one folder down. A version is its folder (`installed/<id>/<version>-<sha12>`), which
 * is also the path Core ML keys its compile by, so a new folder means a new compile and the old one is orphaned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** The parts of jobs' registry.json read here (its own schema validates the rest when it writes). */
const registrySchema = z.looseObject({
  components: z.record(z.string(), z.looseObject({ dir: z.string().min(1) })),
});

const MODEL_SUFFIXES = ['.mlmodelc', '.mlpackage'];
const isModel = (name: string) => MODEL_SUFFIXES.some((suffix) => name.endsWith(suffix));

function holdsCoreMl(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return readdirSync(dir).some((name) => {
    if (isModel(name)) return true;
    const inner = join(dir, name);
    return statSync(inner).isDirectory() && readdirSync(inner).some(isModel);
  });
}

/**
 * The folders (relative to the components root, sorted) of the installed versions that carry Core ML models; null
 * when the registry is missing or unreadable (the component manager repairs it; nothing is decided from it then).
 */
export function coreMlComponentDirs(componentsRoot: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(componentsRoot, 'registry.json'), 'utf8'));
  } catch {
    // Missing or half-written: say "unknown", which makes the sweep keep every compile.
    return null;
  }
  const registry = registrySchema.safeParse(parsed);
  if (!registry.success) return null;
  return Object.values(registry.data.components)
    .map((entry) => entry.dir)
    .filter((dir) => holdsCoreMl(join(componentsRoot, dir)))
    .sort();
}
