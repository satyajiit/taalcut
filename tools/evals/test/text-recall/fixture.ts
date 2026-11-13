// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small library database with the tables and columns the recall eval reads (assets, shots with their on-screen
 * text, stage rows with state, reason, error and output), and a manifest to score it against.
 */
import { DatabaseSync } from 'node:sqlite';

export interface FixtureShot {
  readonly file: string;
  /** Seconds, on a 30 fps grid. */
  readonly from: number;
  readonly to: number;
  readonly text: string | null;
}

export interface FixtureStage {
  readonly file: string;
  readonly stage: string;
  readonly state: string;
  readonly reason?: string;
  readonly error?: string;
  readonly output?: string;
}

export const MANIFEST = {
  set: 'test-set',
  clips: [
    { file: 'a.mp4', onScreen: [{ line: 'PIER 39 FERRY', from: 2, to: 5 }] },
    { file: 'b.mov', onScreen: [{ line: 'SKATE PARK', from: 1, to: 3 }] },
    { file: 'c.mp4', seconds: 10 },
  ],
};

/** OCR made requests: a library read with an engine. */
export const OCR_OUTPUT = JSON.stringify({ shots: [], ocr: { requests: 3, frames: 9 } });

export const SHOTS: readonly FixtureShot[] = [
  { file: 'a.mp4', from: 0, to: 2, text: '00:00:01.000' },
  { file: 'a.mp4', from: 2, to: 6, text: 'PIER 39 FERRY\n39 FERRY' },
  { file: 'b.mov', from: 0, to: 4, text: 'PHRK\nSKATE' },
  { file: 'c.mp4', from: 0, to: 10, text: null },
];

/** Every scored file's shots and on-screen text done, and c.mp4 too. */
export const STAGES: readonly FixtureStage[] = ['a.mp4', 'b.mov', 'c.mp4'].flatMap((file) => [
  { file, stage: 'vision.shots', state: 'done' },
  { file, stage: 'vision.ocr', state: 'done', output: OCR_OUTPUT },
  { file, stage: 'audio.transcript', state: 'skipped', reason: 'indexing.skip.silent' },
]);

export interface LibraryOptions {
  readonly shots?: readonly FixtureShot[];
  readonly stages?: readonly FixtureStage[];
  /** False: a library from before on-screen text (no `on_screen_text` column). */
  readonly textColumn?: boolean;
}

const FPS = 30;

export function writeLibrary(path: string, options: LibraryOptions = {}): string {
  const db = new DatabaseSync(path);
  try {
    const text = options.textColumn === false ? '' : ', on_screen_text TEXT';
    db.exec(`
      CREATE TABLE assets (id TEXT PRIMARY KEY, original_filename TEXT NOT NULL);
      CREATE TABLE shots (id TEXT, asset_id TEXT, index_in_asset INTEGER, start_value INTEGER, start_rate_num INTEGER,
        start_rate_den INTEGER, duration_value INTEGER, duration_rate_num INTEGER, duration_rate_den INTEGER${text});
      CREATE TABLE asset_index_stages (asset_id TEXT, stage TEXT, state TEXT, reason_key TEXT, error TEXT,
        output TEXT);
    `);
    const shots = options.shots ?? SHOTS;
    const stages = options.stages ?? STAGES;
    const files = [...new Set([...shots.map((shot) => shot.file), ...stages.map((stage) => stage.file)])];
    const asset = db.prepare('INSERT INTO assets VALUES (?, ?)');
    for (const file of files) asset.run(`id-${file}`, file);
    const shot = db.prepare(
      options.textColumn === false
        ? 'INSERT INTO shots VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1)'
        : 'INSERT INTO shots VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?)',
    );
    for (const [n, row] of shots.entries()) {
      const index = shots.slice(0, n).filter((other) => other.file === row.file).length;
      const values = [`s${n}`, `id-${row.file}`, index, row.from * FPS, FPS, (row.to - row.from) * FPS, FPS];
      if (options.textColumn === false) shot.run(...values);
      else shot.run(...values, row.text);
    }
    const stage = db.prepare('INSERT INTO asset_index_stages VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of stages)
      stage.run(
        `id-${row.file}`,
        row.stage,
        row.state,
        row.reason ?? null,
        row.error ?? null,
        row.output ?? null,
      );
  } finally {
    db.close();
  }
  return path;
}
