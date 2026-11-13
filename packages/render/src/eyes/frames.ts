// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: stills of any video file and the sheets that put them side by side. A still is media's `extractFrame`
 * (GPU decode first, HDR mapped to SDR, upright), the same cut the kept reel's frames get for a graphic's brief
 * (workspace/template/reel-frames.ts) but at any second of any file: the kept reel, a draft, a library clip. A sheet
 * lays stills out in rows (the reel's, then the draft's) in equal cells with a thin grey rule, as one JPEG: so a whole
 * video's comparison is a few pictures a model can take in one turn, not two per slot. Composing a sheet scales a few
 * small JPEGs already decoded: CPU work with no video decode and no GPU route (ADR 0002's "impossible" case).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, ValidationError, type AsyncResult } from '@taalcut/core';
import { extractFrame, runFfmpeg, type MediaContext } from '@taalcut/media';

export interface Still {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/** A sheet's cell size: the canvas's aspect at `height`, both even. */
export interface CellSize {
  readonly width: number;
  readonly height: number;
}

/** Between cells, and grey where a cell has nothing (no reel kept, no draft yet, the person's frames kept). */
const GAP = 4;
const FILL = '0x808080';

/** The cell for a canvas's aspect at `height` pixels high. */
export function cellOf(
  canvas: { readonly width: number; readonly height: number },
  height: number,
): CellSize {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even((height * canvas.width) / canvas.height), height: even(height) };
}

/** One frame of a video file at `seconds`, as a JPEG at most `longSide` on its longer side. */
export async function stillAt(
  ctx: MediaContext,
  path: string,
  seconds: number,
  longSide: number,
  signal?: AbortSignal,
): AsyncResult<Still> {
  const frame = await extractFrame(
    path,
    { value: Math.max(0, Math.round(seconds * 1000)), rate: 1000 },
    ctx,
    {
      format: 'jpeg',
      maxDimension: longSide,
      jpegQuality: 4,
      ...(signal ? { signal } : {}),
    },
  );
  if (!frame.ok) return frame;
  return ok({ data: frame.value.data, width: frame.value.width, height: frame.value.height });
}

/**
 * Rows of cells as one JPEG: each still fitted into its cell (letterboxed), a null cell grey. Every row has the
 * same number of cells. `dir` is a folder for the stills while FFmpeg reads them; nothing is left in it.
 */
export async function sheetOf(
  ctx: MediaContext,
  dir: string,
  rows: readonly (readonly (Buffer | null)[])[],
  cell: CellSize,
  signal?: AbortSignal,
): AsyncResult<Still> {
  const columns = rows[0]?.length ?? 0;
  if (columns === 0 || rows.some((row) => row.length !== columns))
    return err(
      ValidationError({ field: 'rows' }, { detail: 'A sheet needs rows of the same number of cells' }),
    );
  const width = columns * cell.width + (columns - 1) * GAP;
  const height = rows.length * cell.height + (rows.length - 1) * GAP;
  const work = await mkdtemp(join(dir, 'sheet-'));
  try {
    const inputs: string[] = [];
    const places: string[] = [];
    for (const [row, cells] of rows.entries())
      for (const [column, data] of cells.entries()) {
        if (!data) continue;
        const file = join(work, `${inputs.length}.jpg`);
        await writeFile(file, data);
        inputs.push(file);
        places.push(`${column * (cell.width + GAP)}_${row * (cell.height + GAP)}`);
      }
    const out = join(work, 'sheet.jpg');
    const fit = (index: number) =>
      `[${index}:v]scale=${cell.width}:${cell.height}:force_original_aspect_ratio=decrease,` +
      `pad=${cell.width}:${cell.height}:(ow-iw)/2:(oh-ih)/2:color=${FILL},setsar=1,format=yuv420p[c${index}]`;
    const canvas = `pad=${width}:${height}:0:0:color=${FILL}`;
    const graph =
      inputs.length === 0
        ? `color=c=${FILL}:s=${width}x${height}:d=1,format=yuv420p`
        : inputs.length === 1
          ? `${fit(0)};[c0]pad=${width}:${height}:${places[0]!.replace('_', ':')}:color=${FILL}`
          : `${inputs.map((_, index) => fit(index)).join(';')};` +
            `${inputs.map((_, index) => `[c${index}]`).join('')}xstack=inputs=${inputs.length}:` +
            `layout=${places.join('|')}:fill=${FILL},${canvas}`;
    const run = await runFfmpeg(
      ctx,
      [
        '-y',
        ...inputs.flatMap((file) => ['-i', file]),
        ...(inputs.length === 0 ? ['-f', 'lavfi', '-i', graph] : ['-filter_complex', graph]),
        '-frames:v',
        '1',
        '-q:v',
        '4',
        out,
      ],
      { holdsVideoSession: false, timeoutMs: 30_000, ...(signal ? { signal } : {}) },
    );
    if (!run.ok) return run;
    return ok({ data: await readFile(out), width, height });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
