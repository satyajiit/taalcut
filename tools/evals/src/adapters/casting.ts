// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real casting system: @taalcut/timeline's casting engine (P2-M2) over
 * the eval library's profiles (src/casting/library.ts), vision rerank off.
 * A template case reads its Template v1 file from the library folder; a
 * brief case plans one with @taalcut/templates' formats and casts in story
 * order. The weights under test replace the config's five score weights;
 * every other constant is casting.v1's. Picks map back to manifest paths and
 * the frames the clip uses.
 */
import { join } from 'node:path';
import {
  FrameRate,
  FORMAT_IDS,
  newId,
  RationalTime,
  type CastCandidate,
  type FormatId,
  type ProjectId,
  type Template,
} from '@taalcut/core';
import type { FfmpegBinaries } from '@taalcut/media';
import { migrateTemplate, planFormat } from '@taalcut/templates';
import { CASTING_CONFIG, createCastingEngine, createMemoryShotCatalog } from '@taalcut/timeline';
import { hashingEmbedder, loadCastingLibrary, type LoadedLibrary } from '../casting/library';
import { readJson } from '../files';
import { type CastingCaseInput, type CastingSystem, type CastingVariant, type EvalShot } from './types';

export interface TimelineCastingOptions {
  /** Library name (its manifest's `library`) → its folder. */
  readonly libraries: Readonly<Record<string, string>>;
  readonly binaries: FfmpegBinaries;
  /** Variants asked per case (1–10). Default 2, so variant diversity is measured. */
  readonly variants?: number;
  /** Libraries already profiled with loadCastingLibrary, which aren't probed again; the rest are on first use. */
  readonly profiled?: readonly LoadedLibrary[];
}

const isFormat = (id: string): id is FormatId => (FORMAT_IDS as readonly string[]).includes(id);

function readTemplate(dir: string, file: string): Template {
  const json = readJson(join(dir, file)) as { schemaVersion?: unknown };
  const migrated = migrateTemplate(json, typeof json.schemaVersion === 'number' ? json.schemaVersion : 1);
  if (!migrated.ok) throw new Error(`${file}: ${migrated.error.code} ${migrated.error.detail ?? ''}`);
  return migrated.value;
}

function planBrief(brief: { text: string; formatId: string; targetSeconds: number }): Template {
  if (!isFormat(brief.formatId)) throw new Error(`Unknown format ${brief.formatId}`);
  const planned = planFormat(
    { formatId: brief.formatId, targetSeconds: brief.targetSeconds, brief: brief.text },
    {
      template: () => newId<'Template'>(),
      slot: () => newId<'TemplateSlot'>(),
      overlay: () => newId<'TextOverlay'>(),
    },
  );
  if (!planned.ok) throw new Error(`${brief.formatId}: ${planned.error.code} ${planned.error.detail ?? ''}`);
  return planned.value;
}

/** The manifest path and the frames of the clip the candidate fills its slot with. */
function shotOf(library: LoadedLibrary, candidate: CastCandidate, slotFrames: RationalTime): EvalShot {
  const asset = library.assetOf.get(candidate.assetId);
  if (asset === undefined) throw new Error(`Cast picked an unknown asset ${candidate.assetId}`);
  const rate = candidate.sourceStart.rate;
  const start = RationalTime.toFrames(candidate.sourceStart, rate);
  const length = RationalTime.toFrames(slotFrames, rate, 'ceil');
  return { asset, range: { startFrame: start, endFrame: start + Math.max(1, length) } };
}

export function timelineCastingSystem(options: TimelineCastingOptions): CastingSystem {
  const loaded = new Map((options.profiled ?? []).map((lib) => [lib.name, Promise.resolve(lib)]));
  const library = (name: string) => {
    const found = loaded.get(name);
    if (found) return found;
    const dir = options.libraries[name];
    if (dir === undefined) throw new Error(`No folder for casting library ${name}: pass --library`);
    const loading = loadCastingLibrary(dir, options.binaries);
    loaded.set(name, loading);
    return loading;
  };

  return {
    async cast(input: CastingCaseInput): Promise<CastingVariant[]> {
      const lib = await library(input.library);
      const story = 'brief' in input.template;
      const template =
        'brief' in input.template
          ? planBrief(input.template.brief)
          : readTemplate(lib.dir, input.template.file);
      const { version: _version, ...weights } = input.weights;
      const engine = createCastingEngine({
        catalog: createMemoryShotCatalog(lib.profiles),
        embedder: hashingEmbedder(),
        config: { ...CASTING_CONFIG, weights },
      });
      const result = await engine.cast({
        projectId: newId<'Project'>() as ProjectId,
        template,
        mode: story ? 'story' : 'template',
        variants: Math.min(10, Math.max(1, options.variants ?? 2)),
        seed: input.seed,
        ...('brief' in input.template ? { pool: { query: input.template.brief.text } } : {}),
      });
      if (!result.ok) throw new Error(`${input.caseId}: ${result.error.code} ${result.error.detail ?? ''}`);
      const slotLength = new Map(template.slots.map((slot) => [slot.id, slot.duration]));
      return result.value.variants.map((variant) => ({
        picks: variant.slots.flatMap((slot, slotIndex) => {
          const length = slotLength.get(slot.slotId) ?? RationalTime.of(1, FrameRate.of(30));
          return slot.pick ? [{ slotIndex, ...shotOf(lib, slot.pick, length) }] : [];
        }),
        alternates: variant.slots.map((slot, slotIndex) => {
          const length = slotLength.get(slot.slotId) ?? RationalTime.of(1, FrameRate.of(30));
          return { slotIndex, shots: slot.alternates.map((alternate) => shotOf(lib, alternate, length)) };
        }),
      }));
    },
  };
}
