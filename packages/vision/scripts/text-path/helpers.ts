// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mac helper OCR processes for the IX3-O1 study, started as the app starts its one (`serve --services ocr,image`),
 * each with its own `--allow-root`, and warmed (languages and one read) before anything is timed.
 */
import { mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createJsonLineSidecar, createSidecarResolver, type JsonLineSidecar } from '@taalcut/media';
import { createAppleVisionOcr, type AppleVisionOptions } from '../../src/ocr/apple-vision';
import type { OcrEngine, OcrFrame } from '../../src/ocr/types';

export interface StudyHelper {
  readonly sidecar: JsonLineSidecar;
  readonly tempDir: string;
  /** An Apple Vision engine on this helper with the given options. */
  engine(options?: Omit<AppleVisionOptions, 'tempDir'>): OcrEngine;
}

async function helperPath(): Promise<string> {
  const helper = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env: process.env,
  }).resolve();
  if (!helper.ok) throw new Error(`no mac helper: ${helper.error.code}`);
  return helper.value.path;
}

/**
 * `count` helper processes; helper n may read files under `roots` and its own temp folder `scratch/helper-<n>`.
 * Each is warmed with a read of `warm` (Vision loads its models on the first request).
 */
export async function startHelpers(
  count: number,
  scratch: string,
  roots: readonly string[],
  warm: readonly OcrFrame[],
): Promise<StudyHelper[]> {
  const path = await helperPath();
  const helpers: StudyHelper[] = [];
  for (let n = 0; n < count; n++) {
    const dir = join(scratch, `helper-${n}`);
    await mkdir(dir, { recursive: true });
    const tempDir = await realpath(dir);
    const allow = [tempDir, ...roots].flatMap((root) => ['--allow-root', root]);
    const sidecar = createJsonLineSidecar({
      command: path,
      args: ['serve', '--services', 'ocr,image', ...allow],
    });
    const helper: StudyHelper = {
      sidecar,
      tempDir,
      engine: (options = {}) => createAppleVisionOcr(sidecar, { ...options, tempDir }),
    };
    const warmed = await helper.engine({ inFlight: 1 }).recognize(warm, { languages: ['en'] });
    if (!warmed.ok) throw new Error(`helper ${n} warm-up: ${warmed.error.code} ${warmed.error.detail ?? ''}`);
    helpers.push(helper);
  }
  return helpers;
}

/** Stops each helper, then removes its temp folder (each request's BMPs are gone already; the folder isn't). */
export async function closeHelpers(helpers: readonly StudyHelper[]): Promise<void> {
  for (const helper of helpers) {
    await helper.sidecar.close();
    await rm(helper.tempDir, { recursive: true, force: true });
  }
}
