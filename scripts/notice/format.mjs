// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stable section titles. A line that is exactly one of these starts a section. */
export const SECTION_TITLES = [
  'Third-party packages',
  'Notes',
  'React Bits',
  'page-mascot',
  'FluidAudio',
  'GeoNames',
  'Components',
  'Not on the allowlist',
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });

export function compareText(left, right) {
  return collator.compare(left, right);
}

function pad(value, width) {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function columnWidth(header, cells) {
  let width = header.length;
  for (const cell of cells) if (cell.length > width) width = cell.length;
  return width;
}

/** One line per row. Newlines in a cell would look like a new section. */
export function cell(value) {
  return String(value ?? '')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ')
    .trim();
}

export function formatTable(headers, rows) {
  const data = rows.map((row) => row.map(cell));
  const widths = headers.map((header, index) =>
    columnWidth(
      header,
      data.map((cols) => cols[index]),
    ),
  );
  const line = (cols) =>
    cols
      .map((col, index) => pad(col, widths[index]))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...data.map(line)].join('\n');
}

/** Exactly one trailing newline, LF only. */
export function finish(lines) {
  const text = lines.join('\n').replace(/\n+$/, '');
  return `${text}\n`;
}

function splitSections(text, titles) {
  const titleSet = new Set(titles);
  const sections = new Map();
  let name = 'Header';
  let lines = [];
  const push = () => {
    sections.set(name, lines.join('\n'));
  };
  for (const line of text.replace(/\n$/, '').split('\n')) {
    if (titleSet.has(line)) {
      push();
      name = line;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  push();
  return sections;
}

/**
 * Names of sections whose text differs. Order follows the generated file,
 * then any section that exists only in the previous file.
 */
export function differingSections(previous, next, extraTitles = []) {
  const titles = [...SECTION_TITLES, ...extraTitles];
  const left = splitSections(previous, titles);
  const right = splitSections(next, titles);
  const names = [];
  const seen = new Set();
  for (const name of [...right.keys(), ...left.keys()]) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (left.get(name) !== right.get(name)) names.push(name);
  }
  return names;
}
