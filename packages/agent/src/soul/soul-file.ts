// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * SOUL.md v1 (P3-B15, SPEC section 22): one versioned file holds the persona. Its front matter names the
 * version and each dial's stops; its "Dial stops" table says what every stop changes. The whole file goes
 * into every system prompt verbatim, and the stop lines feed the run's "# Your dials now" block (dials.ts),
 * so the file stays the one source of truth.
 *
 * `parseSoulText` is lenient (any markdown; Phase 1 tests pass bare strings). `readSoul` is what the app
 * loads: a file without a version, or with a dial table that doesn't match its front matter, is
 * `agent.soul_invalid` and the agent doesn't start without its persona.
 */
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { SoulInvalid } from '../errors';

export const SOUL_DIALS = ['tone', 'verbosity'] as const;
export type SoulDial = (typeof SOUL_DIALS)[number];
/** Stops per dial: core's soulDialsSchema takes 0 to 4. */
export const STOPS_PER_DIAL = 5;

export interface DialStop {
  /** The front matter's id, e.g. 'justDoIt'. */
  readonly id: string;
  /** Plain words for the prompt, e.g. 'just do it'. */
  readonly name: string;
  /** What the stop changes, from the Dial stops table. */
  readonly says: string;
}

export type SoulStops = Readonly<Record<SoulDial, readonly DialStop[]>>;

export interface Soul {
  readonly version: string;
  /** The whole file, front matter included: it goes into the prompt verbatim. */
  readonly text: string;
  /** SOUL.md v1's dial stops, in order; absent in a file without them (no dial block is built). */
  readonly stops?: SoulStops;
  /** One run's "# Your dials now" block, which follows the file in every prompt of the run (dials.ts). */
  readonly dialBlock?: string;
}

const stopId = z.string().regex(/^[a-z][a-zA-Z]*$/);
const frontMatterSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, { message: 'version must be major.minor.patch' }),
  updated: z.iso.date(),
  dials: z.object({
    tone: z.array(stopId).length(STOPS_PER_DIAL),
    verbosity: z.array(stopId).length(STOPS_PER_DIAL),
  }),
});
type FrontMatter = z.output<typeof frontMatterSchema>;

const FRONT_MATTER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const DIAL_TABLE_HEADING = /^# Dial stops[ \t]*$/m;

/** Any markdown: the version from the front matter ('unversioned' without one), stops when they parse. */
export function parseSoulText(markdown: string): Soul {
  const text = markdown.trim();
  const fields = frontMatterFields(normalise(markdown));
  const version = typeof fields?.version === 'string' && fields.version ? fields.version : 'unversioned';
  const parts = readParts(markdown);
  return { version, text, ...(parts.ok ? { stops: parts.value.stops } : {}) };
}

/** SOUL.md as the app loads it: versioned, with a dial table that matches the front matter. */
export function readSoul(markdown: string): Result<Soul> {
  const parts = readParts(markdown);
  if (!parts.ok) return parts;
  return ok({ version: parts.value.fields.version, text: markdown.trim(), stops: parts.value.stops });
}

function readParts(markdown: string): Result<{ readonly fields: FrontMatter; readonly stops: SoulStops }> {
  const text = normalise(markdown);
  const raw = frontMatterFields(text);
  if (!raw) return err(SoulInvalid({ reason: 'frontMatter' }, { detail: 'SOUL.md has no front matter.' }));
  const fields = frontMatterSchema.safeParse(raw);
  if (!fields.success)
    return err(SoulInvalid({ reason: 'frontMatter' }, { detail: z.prettifyError(fields.error) }));
  const rows = tableRows(text);
  if (!rows.ok) return rows;
  const stops = matchStops(fields.data, rows.value);
  return stops.ok ? ok({ fields: fields.data, stops: stops.value }) : stops;
}

/** The front matter as flat `key: value` lines, with one level of nesting (`dials:`) and inline lists. */
function frontMatterFields(text: string): Record<string, unknown> | undefined {
  const block = FRONT_MATTER.exec(text)?.[1];
  if (block === undefined) return undefined;
  const fields: Record<string, unknown> = {};
  let nested: Record<string, unknown> | undefined;
  for (const line of block.split('\n')) {
    const content = line.replace(/\s+#.*$/, '');
    if (!content.trim()) continue;
    const match = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(content);
    if (!match) continue;
    const [, indent = '', key = '', value = ''] = match;
    if (indent.length > 0 && nested) {
      nested[key] = scalar(value);
    } else if (value === '') {
      nested = {};
      fields[key] = nested;
    } else {
      nested = undefined;
      fields[key] = scalar(value);
    }
  }
  return fields;
}

function scalar(value: string): string | string[] {
  const trimmed = value.trim();
  const list = /^\[(.*)\]$/.exec(trimmed);
  if (!list) return unquote(trimmed);
  return (list[1] ?? '')
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, '$2');

interface TableRow {
  readonly dial: string;
  readonly stop: string;
  readonly name: string;
  readonly says: string;
}

/** The rows of the table under "# Dial stops", header and separator left out. */
function tableRows(text: string): Result<TableRow[]> {
  const heading = DIAL_TABLE_HEADING.exec(text);
  if (!heading) return err(SoulInvalid({ reason: 'dialTable' }, { detail: 'No "# Dial stops" section.' }));
  const after = text.slice(heading.index + heading[0].length);
  const section = after.split(/^# /m)[0] ?? '';
  const rows: TableRow[] = [];
  for (const line of section.split('\n').filter((l) => l.trim().startsWith('|'))) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (cells.length !== 4)
      return err(SoulInvalid({ reason: 'dialTable' }, { detail: `A dial row needs 4 cells: ${line}` }));
    const [dial = '', stop = '', name = '', says = ''] = cells;
    if (dial.toLowerCase() === 'dial') continue;
    if (!name || !says)
      return err(SoulInvalid({ reason: 'dialTable' }, { detail: `Empty cell in the dial row: ${line}` }));
    rows.push({ dial, stop, name, says });
  }
  return ok(rows);
}

/** One row per front matter stop, in the front matter's order, and nothing else. */
function matchStops(fields: FrontMatter, rows: readonly TableRow[]): Result<SoulStops> {
  const stops: Record<SoulDial, DialStop[]> = { tone: [], verbosity: [] };
  for (const dial of SOUL_DIALS) {
    const own = rows.filter((row) => row.dial === dial);
    const ids = own.map((row) => row.stop);
    if (ids.join(',') !== fields.dials[dial].join(','))
      return err(
        SoulInvalid(
          { reason: 'dialTable' },
          { detail: `The ${dial} rows (${ids.join(', ')}) don't match the front matter's stops.` },
        ),
      );
    stops[dial] = own.map((row) => ({ id: row.stop, name: row.name, says: row.says }));
  }
  const unknown = rows.find((row) => !(SOUL_DIALS as readonly string[]).includes(row.dial));
  if (unknown)
    return err(SoulInvalid({ reason: 'dialTable' }, { detail: `Unknown dial '${unknown.dial}'.` }));
  return ok(stops);
}

function normalise(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
}
