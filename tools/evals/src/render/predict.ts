// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders goldens with a RenderSystem into a folder `render check --renders`
 * reads: `<id>.mkv` (the strip read-back), `<id>.wav` (its sound) and
 * `<id>.qa.json` (whether the export passed QA first time, and what failed or warned).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type RenderQaOutcome, type RenderSystem } from '../adapters/types';
import { type LoadedGolden } from './load';

export interface RenderQaNote {
  readonly qaPassed: boolean;
  readonly verdict: string | null;
  readonly failed: readonly string[];
  readonly warned: readonly string[];
  readonly seconds: number;
}

export const qaNotePath = (rendersDir: string, id: string) => join(rendersDir, `${id}.qa.json`);

/** The note a predict run left beside a render, if any. */
export function readQaNote(rendersDir: string, id: string): RenderQaNote | undefined {
  const path = qaNotePath(rendersDir, id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as RenderQaNote) : undefined;
}

export async function predictRenders(
  system: RenderSystem,
  goldens: readonly LoadedGolden[],
  outDir: string,
  qa: ReadonlyMap<string, RenderQaOutcome>,
): Promise<RenderQaNote[]> {
  mkdirSync(outDir, { recursive: true });
  const notes: RenderQaNote[] = [];
  for (const { golden } of goldens) {
    const started = Date.now();
    const output = await system.render({
      goldenId: golden.id,
      timeline: golden,
      outPath: join(outDir, `${golden.id}.mkv`),
    });
    const seen = qa.get(golden.id);
    const note: RenderQaNote = {
      qaPassed: output.qaPassed === true,
      verdict: seen?.verdict ?? null,
      failed: seen?.failed ?? [],
      warned: seen?.warned ?? [],
      seconds: (Date.now() - started) / 1000,
    };
    writeFileSync(qaNotePath(outDir, golden.id), `${JSON.stringify(note, null, 2)}\n`);
    notes.push(note);
  }
  return notes;
}
