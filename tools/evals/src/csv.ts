// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { parseGoldenReel, type GoldenReel } from './schema';

export const CSV_COLUMNS = [
  'record_type',
  'reel_id',
  'synthetic',
  'note',
  'source_label',
  'source_uri',
  'duration_frames',
  'width',
  'height',
  'fps_numerator',
  'fps_denominator',
  'audio_type',
  'languages',
  'frame',
  'kind',
  'slot_id',
  'start_frame',
  'end_frame',
  'intent',
  'overlay_id',
  'text',
  'x',
  'y',
  'w',
  'h',
] as const;

const RECORD_TYPES = new Set(['reel', 'cut', 'beat', 'slot', 'overlay', 'transition']);

type Row = Record<string, string>;

/** RFC 4180 reader. Quoted fields may contain commas, quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) break;
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (inQuotes) throw new Error('CSV has an unclosed quote');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function blank(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  return String(value);
}

function rowFrom(record: Partial<Record<(typeof CSV_COLUMNS)[number], string | number | boolean>>): string {
  return CSV_COLUMNS.map((column) => csvCell(blank(record[column]))).join(',');
}

export function reelsToCsv(reels: readonly GoldenReel[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const reel of reels) {
    lines.push(
      rowFrom({
        record_type: 'reel',
        reel_id: reel.reelId,
        synthetic: reel.synthetic,
        note: reel.note,
        source_label: reel.source.label,
        source_uri: reel.source.uri,
        duration_frames: reel.source.durationFrames,
        width: reel.source.width,
        height: reel.source.height,
        fps_numerator: reel.frameRate.numerator,
        fps_denominator: reel.frameRate.denominator,
        audio_type: reel.audio.type,
        languages: reel.languages.join('|'),
      }),
    );
    for (const frame of reel.cuts) lines.push(rowFrom({ record_type: 'cut', reel_id: reel.reelId, frame }));
    for (const beat of reel.beats) {
      lines.push(rowFrom({ record_type: 'beat', reel_id: reel.reelId, frame: beat.frame, kind: beat.kind }));
    }
    for (const slot of reel.slots) {
      lines.push(
        rowFrom({
          record_type: 'slot',
          reel_id: reel.reelId,
          slot_id: slot.id,
          start_frame: slot.startFrame,
          end_frame: slot.endFrame,
          intent: slot.intent,
        }),
      );
    }
    for (const overlay of reel.overlays) {
      lines.push(
        rowFrom({
          record_type: 'overlay',
          reel_id: reel.reelId,
          overlay_id: overlay.id,
          text: overlay.text,
          start_frame: overlay.startFrame,
          end_frame: overlay.endFrame,
          x: overlay.position.x,
          y: overlay.position.y,
          w: overlay.position.width,
          h: overlay.position.height,
        }),
      );
    }
    for (const transition of reel.transitions) {
      lines.push(
        rowFrom({
          record_type: 'transition',
          reel_id: reel.reelId,
          frame: transition.atFrame,
          kind: transition.kind,
        }),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function records(table: string[][]): { line: number; row: Row }[] {
  const header = table[0];
  if (header === undefined) throw new Error('CSV is empty');
  for (const column of CSV_COLUMNS) {
    if (!header.includes(column)) throw new Error(`CSV header is missing ${column}`);
  }
  return table.slice(1).map((cells, index) => {
    if (cells.length > header.length) throw new Error(`CSV row ${index + 2} has more cells than the header`);
    const row: Row = {};
    header.forEach((name, cellIndex) => {
      row[name] = cells[cellIndex] ?? '';
    });
    return { line: index + 2, row };
  });
}

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

function requiredInt(row: Row, key: string, where: string): number {
  const raw = cell(row, key);
  if (!/^\d+$/.test(raw))
    throw new Error(`${where}: ${key} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

function optionalInt(row: Row, key: string, where: string): number | undefined {
  const raw = cell(row, key);
  if (raw.length === 0) return undefined;
  return requiredInt(row, key, where);
}

function optionalNumber(row: Row, key: string, where: string): number | undefined {
  const raw = cell(row, key);
  if (raw.length === 0) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`${where}: ${key} must be a number, got ${JSON.stringify(raw)}`);
  return value;
}

interface Draft {
  reelId: string;
  synthetic: boolean;
  note: string;
  source: GoldenReel['source'];
  frameRate: GoldenReel['frameRate'];
  cuts: number[];
  beats: GoldenReel['beats'];
  slots: GoldenReel['slots'];
  overlays: GoldenReel['overlays'];
  transitions: GoldenReel['transitions'];
  audio: GoldenReel['audio'];
  languages: string[];
}

function reelDraft(row: Row, where: string): Draft {
  const reelId = cell(row, 'reel_id');
  const synthetic = cell(row, 'synthetic');
  if (synthetic !== 'true' && synthetic !== 'false') {
    throw new Error(`${where}: synthetic must be true or false`);
  }
  const languages = cell(row, 'languages')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const uri = cell(row, 'source_uri');
  return {
    reelId,
    synthetic: synthetic === 'true',
    note: cell(row, 'note'),
    source: {
      label: cell(row, 'source_label'),
      ...(uri.length > 0 ? { uri } : {}),
      durationFrames: requiredInt(row, 'duration_frames', where),
      ...(optionalInt(row, 'width', where) !== undefined ? { width: optionalInt(row, 'width', where) } : {}),
      ...(optionalInt(row, 'height', where) !== undefined
        ? { height: optionalInt(row, 'height', where) }
        : {}),
    },
    frameRate: {
      numerator: requiredInt(row, 'fps_numerator', where),
      denominator: requiredInt(row, 'fps_denominator', where),
    },
    cuts: [],
    beats: [],
    slots: [],
    overlays: [],
    transitions: [],
    audio: { type: cell(row, 'audio_type') as GoldenReel['audio']['type'] },
    languages,
  };
}

export function reelsFromCsv(text: string): GoldenReel[] {
  const drafts = new Map<string, Draft>();
  const order: string[] = [];
  for (const { line, row } of records(parseCsv(text))) {
    const recordType = cell(row, 'record_type');
    const where = `CSV row ${line} (${recordType || 'blank'})`;
    if (!RECORD_TYPES.has(recordType))
      throw new Error(`${where}: unknown record_type ${JSON.stringify(recordType)}`);
    const reelId = cell(row, 'reel_id');
    if (reelId.length === 0) throw new Error(`${where}: reel_id is empty`);
    if (recordType === 'reel') {
      if (drafts.has(reelId)) throw new Error(`${where}: duplicate reel ${reelId}`);
      drafts.set(reelId, reelDraft(row, where));
      order.push(reelId);
      continue;
    }
    const draft = drafts.get(reelId);
    if (draft === undefined) throw new Error(`${where}: no reel row for ${reelId} yet`);
    if (recordType === 'cut') draft.cuts.push(requiredInt(row, 'frame', where));
    else if (recordType === 'beat') {
      draft.beats.push({
        frame: requiredInt(row, 'frame', where),
        kind: cell(row, 'kind') as Draft['beats'][number]['kind'],
      });
    } else if (recordType === 'slot') {
      draft.slots.push({
        id: cell(row, 'slot_id'),
        startFrame: requiredInt(row, 'start_frame', where),
        endFrame: requiredInt(row, 'end_frame', where),
        intent: cell(row, 'intent'),
      });
    } else if (recordType === 'overlay') {
      const width = optionalNumber(row, 'w', where);
      const height = optionalNumber(row, 'h', where);
      draft.overlays.push({
        id: cell(row, 'overlay_id'),
        text: row['text'] ?? '',
        startFrame: requiredInt(row, 'start_frame', where),
        endFrame: requiredInt(row, 'end_frame', where),
        position: {
          x: optionalNumber(row, 'x', where) ?? Number.NaN,
          y: optionalNumber(row, 'y', where) ?? Number.NaN,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        },
      });
    } else {
      draft.transitions.push({
        atFrame: requiredInt(row, 'frame', where),
        kind: cell(row, 'kind') as Draft['transitions'][number]['kind'],
      });
    }
  }
  return order.map((reelId) => parseGoldenReel(drafts.get(reelId), `reel ${reelId}`));
}
